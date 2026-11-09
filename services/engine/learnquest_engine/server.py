import hmac
import logging
import os
import time
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    BadRequestError,
    ContextWindowExceededError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    ServiceUnavailableError,
    Timeout,
)
from pydantic import BaseModel, Field

from learnquest_engine import guide, learner, llm, pipeline, visual
from learnquest_engine.config import get_settings
from learnquest_engine.guide import LintFinding
from learnquest_engine.llm import GenerationError, Result
from learnquest_engine.schemas import LessonContext

log = logging.getLogger(__name__)
MAX_BODY_BYTES = 64 * 1024

app = FastAPI(title="LearnSlop engine", docs_url=None, redoc_url=None)


class OutlineRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)


class VisualRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)


class GuideMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=2000)


class GuideWorkspaceFile(BaseModel):
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=6000)


class GuideRequest(BaseModel):
    fileName: str = Field(min_length=1, max_length=240)
    language: str = Field(min_length=1, max_length=40)
    code: str = Field(max_length=12000)
    selection: str = Field(default="", max_length=3000)
    messages: list[GuideMessage] = Field(min_length=1, max_length=8)
    workspaceFiles: list[GuideWorkspaceFile] = Field(default_factory=list, max_length=24)
    lintFinding: LintFinding | None = None


def require_token(x_engine_token: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().ENGINE_TOKEN.get_secret_value()
    if x_engine_token is None or not hmac.compare_digest(
        x_engine_token.encode(), expected.encode()
    ):
        raise HTTPException(status_code=401, detail="unauthorized")


def _body(key: str, result: Result[Any]) -> dict[str, Any]:
    return {
        key: result.value.model_dump(exclude_none=True),
        "usage": result.usage,
        "attempts": result.attempts,
    }


class CapBody:
    """Pure ASGI middleware: refuse bodies over MAX_BODY_BYTES, counting the bytes actually read.

    Content-Length is only a hint (chunked bodies have none), so the stream is capped too.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        length = dict(scope["headers"]).get(b"content-length", b"")
        too_large = JSONResponse(status_code=413, content={"error": "too_large"})
        if length.isdigit() and int(length) > MAX_BODY_BYTES:
            await too_large(scope, receive, send)
            return
        llm.start_request_deadline()
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break  # client went away
            size += len(message.get("body", b""))
            if size > MAX_BODY_BYTES:
                await too_large(scope, receive, send)
                return
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        replayed = False

        async def replay() -> Any:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


app.add_middleware(CapBody)


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "sha": os.environ.get("GIT_SHA", "unknown")}


@app.post("/v1/pipeline/outline", dependencies=[Depends(require_token)])
def outline_route(body: OutlineRequest) -> dict[str, Any]:
    return _body("outline", pipeline.outline(body.topic))


@app.post("/v1/pipeline/lesson", dependencies=[Depends(require_token)])
def lesson_route(body: LessonContext) -> dict[str, Any]:
    return _body("lesson", pipeline.lesson(body))


@app.post("/v1/pipeline/visual", dependencies=[Depends(require_token)])
def visual_route(body: VisualRequest) -> JSONResponse:
    t0 = time.monotonic()
    first = visual.generate_visual(body.prompt)
    t1 = time.monotonic()
    doc = visual.unwrap(first.value.model_dump())
    found = visual.all_issues(doc)
    t2 = time.monotonic()
    log.warning(
        "visual: first pass %.1fs (attempts=%d, completion_tokens=%d), checks %.1fs, issues=%d",
        t1 - t0,
        first.attempts,
        first.usage["completion_tokens"],
        t2 - t1,
        len(found),
    )
    if found:
        # One repair call with the exact problems, then give up with a clear 422.
        log.warning("visual: first pass issues: %s", found)
        repaired = visual.generate_visual(body.prompt, found, doc)
        t3 = time.monotonic()
        doc = visual.unwrap(repaired.value.model_dump())
        found = visual.all_issues(doc)
        log.warning(
            "visual: repair pass %.1fs (attempts=%d, completion_tokens=%d), checks %.1fs",
            t3 - t2,
            repaired.attempts,
            repaired.usage["completion_tokens"],
            time.monotonic() - t3,
        )
        log.warning("visual: after repair: %s", found)
    if found:
        return JSONResponse(
            status_code=422,
            content={"error": "Model output failed the visual schema", "issues": found},
        )
    return JSONResponse({"doc": doc})


@app.post("/v1/guide/chat", dependencies=[Depends(require_token)])
def guide_chat_route(body: GuideRequest) -> dict[str, Any]:
    # exclude_none keeps the model input unchanged when no lint finding is sent.
    result = guide.reply(body.model_dump(exclude_none=True))
    return _body("guide", result)


@app.post("/v1/mastery/update", dependencies=[Depends(require_token)])
def mastery_update_route(body: learner.MasteryUpdateRequest) -> learner.MasteryUpdateResponse:
    try:
        return learner.update_mastery(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/v1/next", dependencies=[Depends(require_token)])
def next_route(body: learner.NextRequest) -> learner.NextResponse:
    return learner.next_step(body)


@app.exception_handler(visual.CheckerUnavailable)
def checker_unavailable(_: Request, exc: visual.CheckerUnavailable) -> JSONResponse:
    # Fail closed: a document the checker never saw must not be served as valid.
    log.error("visual checker unavailable: %s", exc)
    return JSONResponse(
        status_code=503,
        content={"error": "visual checker unavailable", "issues": []},
    )


@app.exception_handler(GenerationError)
def generation_error(_: Request, exc: GenerationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": "invalid_output", "errors": exc.errors})


@app.exception_handler(AuthenticationError)
def provider_auth(_: Request, exc: AuthenticationError) -> JSONResponse:
    # Log the cause for the operator; the client only learns that the upstream failed.
    log.error("LLM provider rejected the credentials; check LLM_API_KEY")
    return JSONResponse(status_code=502, content={"error": "upstream"})


@app.exception_handler(Timeout)
@app.exception_handler(RateLimitError)
@app.exception_handler(ServiceUnavailableError)
@app.exception_handler(APIConnectionError)
@app.exception_handler(BadRequestError)
@app.exception_handler(NotFoundError)
@app.exception_handler(ContextWindowExceededError)
@app.exception_handler(PermissionDeniedError)
@app.exception_handler(APIError)
def upstream(_: Request, exc: Exception) -> JSONResponse:
    log.error("LLM upstream failure: %s", type(exc).__name__)
    return JSONResponse(status_code=502, content={"error": "upstream"})
