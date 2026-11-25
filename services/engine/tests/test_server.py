import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import litellm
import pytest
from fastapi.testclient import TestClient

from learnquest_engine.server import app

TOKEN = {"X-Engine-Token": "x" * 32}
CTX = {
    "path": {"title": "Learn Rust", "tagline": "From ownership to traits"},
    "course": {"title": "Basics", "description": "Variables and functions"},
    "lesson": {"title": "Variables", "level": 1, "concepts": ["let", "mut"]},
    "missedConcepts": [],
}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_healthz_needs_no_token(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GIT_SHA", "abc123")
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "sha": "abc123"}


def test_healthz_reports_unknown_sha_when_unset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("GIT_SHA", raising=False)
    r = client.get("/healthz")
    assert r.json() == {"ok": True, "sha": "unknown"}


@pytest.mark.parametrize("headers", [{}, {"X-Engine-Token": "y" * 32}])
def test_missing_or_wrong_token_is_401(client: TestClient, headers: dict[str, str]) -> None:
    r = client.post("/v1/pipeline/outline", json={"topic": "rust"}, headers=headers)
    assert r.status_code == 401


@pytest.mark.parametrize("with_memory", [False, True])
def test_outline_shape(
    client: TestClient, fake_llm: Callable[[str], list[dict[str, Any]]], with_memory: bool
) -> None:
    calls = fake_llm("outline_rust")
    request: dict[str, Any] = {"topic": "rust"}
    focus = ["js.return-values", "js.functions"] if with_memory else []
    if with_memory:
        request["learnerMemory"] = {"focusConcepts": focus}
    r = client.post("/v1/pipeline/outline", json=request, headers=TOKEN)
    assert r.status_code == 200
    body = r.json()
    assert body["outline"]["title"] == "Learn Rust"
    assert body["usage"]["prompt_tokens"] == 10
    assert body["attempts"] == 1
    assert json.loads(r.headers["x-engine-usage"]) == [
        {"prompt_tokens": 10, "completion_tokens": 5, "model": "openai/test", "estimated_usd": None}
    ]
    payload = json.loads(calls[0]["messages"][1]["content"].split("\n", 1)[1])
    assert payload == {"topic": "rust", "learnerMemory": {"focusConcepts": focus}}


@pytest.mark.parametrize("focus", [["js.variables"] * 7, ["a private concept title"]])
def test_outline_refuses_invalid_learner_memory(client: TestClient, focus: list[str]) -> None:
    request = {"topic": "JavaScript", "learnerMemory": {"focusConcepts": focus}}
    r = client.post("/v1/pipeline/outline", json=request, headers=TOKEN)
    assert r.status_code == 422


def test_lesson_shape(client: TestClient, fake_llm: Callable[[str], list[dict[str, Any]]]) -> None:
    fake_llm("lesson_rust_1")
    r = client.post("/v1/pipeline/lesson", json=CTX, headers=TOKEN)
    assert r.status_code == 200
    assert len(r.json()["lesson"]["steps"]) >= 3


def test_invalid_twice_is_422(
    client: TestClient, fake_llm: Callable[[str], list[dict[str, Any]]]
) -> None:
    fake_llm("lesson_invalid_twice")
    r = client.post("/v1/pipeline/lesson", json=CTX, headers=TOKEN)
    assert r.status_code == 422
    assert r.json()["error"] == "invalid_output"
    assert json.loads(r.headers["x-engine-usage"]) == [
        {"prompt_tokens": 10, "completion_tokens": 5, "model": "openai/test", "estimated_usd": None}
    ] * 2


@pytest.mark.parametrize("repairs_stem", [True, False])
def test_predict_stem_leak_gets_one_targeted_repair(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, repairs_stem: bool
) -> None:
    fixtures = Path(__file__).parent / "fixtures"
    lesson = json.loads((fixtures / "lesson1.json").read_text())
    step = lesson["steps"][1]
    leaking_step = {**step, "scenario": "Give cartTotal an optional parameter discount = 0."}
    leaking_lesson = {"steps": [lesson["steps"][0], leaking_step, lesson["steps"][2]]}
    calls = 0

    def completion(**kwargs: Any) -> litellm.ModelResponse:
        nonlocal calls
        calls += 1
        assert calls <= 2
        reply = leaking_lesson
        if calls == 2:
            feedback = kwargs["messages"][-1]["content"]
            issues = json.loads(feedback.split("\n", 1)[1])
            assert len(issues) == 1
            issue = issues[0]
            assert issue["loc"] == ["steps", 1]
            assert issue["type"] == "predict_stem_answer_leak"
            assert "scenario and question" in issue["msg"]
            assert "another consequence" in issue["msg"]
            assert step["options"][step["answer"]] not in feedback
            if repairs_stem:
                reply = lesson
        return litellm.ModelResponse(
            choices=[{"index": 0, "message": {"role": "assistant", "content": json.dumps(reply)}}],
            usage={"prompt_tokens": 10, "completion_tokens": 5},
        )

    monkeypatch.setattr(litellm, "completion", completion)
    ctx = {
        "path": {"title": "JavaScript", "tagline": "Learn functions"},
        "course": {"title": "Cart totals", "description": "Add up prices"},
        "lesson": {"title": "Optional parameters", "level": 1, "concepts": ["functions"]},
        "missedConcepts": [],
    }
    r = client.post("/v1/pipeline/lesson", json=ctx, headers=TOKEN)
    assert calls == 2
    assert len(json.loads(r.headers["x-engine-usage"])) == 2
    if repairs_stem:
        assert r.status_code == 200
        assert r.json()["attempts"] == 2
        repaired = r.json()["lesson"]["steps"][1]
        for key in ("scenario", "beforeFiles", "hunks", "options", "answer"):
            assert repaired[key] == step[key]
    else:
        assert r.status_code == 422
        assert r.json()["error"] == "invalid_output"
        assert json.loads(r.json()["errors"])[0]["type"] == "predict_stem_answer_leak"
        assert step["options"][step["answer"]] not in r.text


def test_upstream_timeout_is_504(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def timeout(**_: Any) -> None:
        raise litellm.exceptions.Timeout("slow", "openai/test", "openai")

    monkeypatch.setattr(litellm, "completion", timeout)
    r = client.post("/v1/pipeline/outline", json={"topic": "rust"}, headers=TOKEN)
    assert r.status_code == 504
    assert r.json() == {"error": "timeout"}


def test_oversize_body_is_413(client: TestClient) -> None:
    r = client.post(
        "/v1/pipeline/outline",
        content=b"{}",
        headers={**TOKEN, "content-type": "application/json", "content-length": str(65 * 1024)},
    )
    assert r.status_code == 413


def test_topic_length_is_validated(client: TestClient) -> None:
    r = client.post("/v1/pipeline/outline", json={"topic": "x" * 201}, headers=TOKEN)
    assert r.status_code == 422


@pytest.mark.parametrize(
    "exc",
    [
        litellm.exceptions.BadRequestError("bad key sk-secret", "openai/test", "openai"),
        litellm.exceptions.NotFoundError("no model", "openai/test", "openai"),
        litellm.exceptions.ContextWindowExceededError("too long", "openai/test", "openai"),
        litellm.exceptions.PermissionDeniedError(
            "denied",
            "openai",
            "openai/test",
            response=httpx.Response(403, request=httpx.Request("POST", "http://x")),
        ),
    ],
)
def test_other_litellm_errors_are_502_without_details(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, exc: Exception
) -> None:
    def fail(**_: Any) -> None:
        raise exc

    monkeypatch.setattr(litellm, "completion", fail)
    r = client.post("/v1/pipeline/outline", json={"topic": "rust"}, headers=TOKEN)
    assert r.status_code == 502
    assert r.json() == {"error": "upstream"}


def test_roadmap_rate_limit_preserves_retry_delay(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    def fail(**_: Any) -> None:
        nonlocal calls
        calls += 1
        raise litellm.exceptions.RateLimitError(
            "provider-specific detail",
            "openai/test",
            "openai",
            response=httpx.Response(
                429, headers={"retry-after": "90"}, request=httpx.Request("POST", "https://test")
            ),
        )

    monkeypatch.setattr(litellm, "completion", fail)
    r = client.post("/v1/pipeline/roadmap-topics", json={"topic": "JavaScript"}, headers=TOKEN)
    assert r.status_code == 429
    assert r.headers["retry-after"] == "90"
    assert r.json() == {"error": "rate_limited"}
    assert calls == 1


def test_chunked_oversize_body_is_413(client: TestClient) -> None:
    def chunks() -> Any:
        for _ in range(70):
            yield b" " * 1024

    r = client.post(
        "/v1/pipeline/outline",
        content=chunks(),
        headers={**TOKEN, "content-type": "application/json"},
    )
    assert r.status_code == 413
    assert "content-length" not in r.request.headers


def test_lesson_context_fields_are_capped(client: TestClient) -> None:
    ctx = {**CTX, "missedConcepts": ["x"] * 51}
    r = client.post("/v1/pipeline/lesson", json=ctx, headers=TOKEN)
    assert r.status_code == 422

@pytest.mark.parametrize(
    ("base", "cost"), [("https://api.openai.com/v1/", 0), ("http://local", None)]
)
def test_moderation_usage_header(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, base: str, cost: float | None,
) -> None:
    from unittest.mock import Mock

    result = Mock(usage=None)
    result.model_dump.return_value = {"results": [{"flagged": False}]}
    monkeypatch.setattr(litellm, "moderation", Mock(return_value=result))
    r = client.post("/v1/moderation", headers=TOKEN, json={
        "input": "private", "model": "omni-moderation-latest", "apiBase": base, "apiKey": "secret",
    })
    assert r.status_code == 200
    assert json.loads(r.headers["x-engine-usage"]) == [{
        "model": "omni-moderation-latest", "prompt_tokens": 0, "completion_tokens": 0,
        "estimated_usd": cost,
    }]


def test_roadmap_plans_and_builds_a_one_lesson_section(
    client: TestClient, fake_llm: Callable[[str], list[dict[str, Any]]]
) -> None:
    calls = fake_llm("roadmap_variables")
    extracted = client.post(
        "/v1/pipeline/roadmap-topics", json={"topic": "variables"}, headers=TOKEN
    )
    assert extracted.status_code == 200, extracted.text
    topics = extracted.json()["plan"]["topics"]
    result = client.post(
        "/v1/pipeline/roadmap", json={"topic": "variables", "requested": topics}, headers=TOKEN,
    )
    assert result.status_code == 200, result.text
    plan = result.json()["plan"]
    section = plan["sections"][0]
    assert section["units"] == [{"topicId": "js.variables", "lessonCount": 1}]
    batch = client.post("/v1/pipeline/roadmap-batch", json={
        "pathTitle": plan["title"], "sectionTitle": section["title"],
        "sectionOutcome": section["description"], "topic": topics[0]["title"],
        "outcome": plan["topics"][0]["outcome"], "offset": 0, "count": 1, "total": 1,
        "previous": [],
    }, headers=TOKEN)
    assert batch.status_code == 200, batch.text
    lesson = batch.json()["plan"]["lessons"][0]
    built = client.post("/v1/pipeline/lesson", json={
        **CTX, "lesson": {**lesson, "level": 7, "concepts": ["js.variables"]},
    }, headers=TOKEN)
    assert built.status_code == 200, built.text
    assert built.json()["lesson"]["workedExample"]["code"] == "const limit = 8;"
    assert len(calls) == 4
