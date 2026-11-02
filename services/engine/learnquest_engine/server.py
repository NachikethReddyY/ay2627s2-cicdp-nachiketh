import hmac
import logging
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from litellm.exceptions import (
    APIConnectionError,
    APIError,
    AuthenticationError,
    RateLimitError,
    ServiceUnavailableError,
    Timeout,
)
from pydantic import BaseModel, Field

from learnquest_engine import pipeline, visual
from learnquest_engine.config import get_settings
from learnquest_engine.llm import GenerationError, Result
from learnquest_engine.schemas import LessonContext

log = logging.getLogger(__name__)
MAX_BODY_BYTES = 64 * 1024

app = FastAPI(title="LearnQuest engine", docs_url=None, redoc_url=None)


class OutlineRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)


class VisualRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)


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


@app.middleware("http")
async def cap_body(request: Request, call_next: Any) -> Any:
    # shortcut: only Content-Length is checked, chunked bodies are uncapped,
    # upgrade to a streaming size check if the engine is ever exposed publicly.
    length = request.headers.get("content-length", "0")
    if length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"error": "too_large"})
    return await call_next(request)


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True, "model": get_settings().LLM_MODEL}


@app.post("/v1/pipeline/outline", dependencies=[Depends(require_token)])
def outline_route(body: OutlineRequest) -> dict[str, Any]:
    return _body("outline", pipeline.outline(body.topic))


@app.post("/v1/pipeline/lesson", dependencies=[Depends(require_token)])
def lesson_route(body: LessonContext) -> dict[str, Any]:
    return _body("lesson", pipeline.lesson(body))


@app.post("/v1/pipeline/visual", dependencies=[Depends(require_token)])
def visual_route(body: VisualRequest) -> JSONResponse:
    key = get_settings().LLM_API_KEY
    if key is None or not key.get_secret_value():
        return JSONResponse(
            status_code=503,
            content={"error": "LLM not configured (LLM_API_KEY is empty)", "issues": []},
        )
    doc = visual.generate_visual(body.prompt).value.model_dump()
    found = visual.issues(doc)
    if found:
        return JSONResponse(
            status_code=422,
            content={"error": "Model output failed the visual schema", "issues": found},
        )
    return JSONResponse({"doc": doc})


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
@app.exception_handler(APIError)
def upstream(_: Request, exc: Exception) -> JSONResponse:
    log.error("LLM upstream failure: %s", type(exc).__name__)
    return JSONResponse(status_code=502, content={"error": "upstream"})
