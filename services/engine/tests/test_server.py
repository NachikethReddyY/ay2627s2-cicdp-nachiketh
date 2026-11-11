from collections.abc import Callable
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


def test_outline_shape(client: TestClient, fake_llm: Callable[[str], list[dict[str, Any]]]) -> None:
    fake_llm("outline_rust")
    r = client.post("/v1/pipeline/outline", json={"topic": "rust"}, headers=TOKEN)
    assert r.status_code == 200
    body = r.json()
    assert body["outline"]["title"] == "Learn Rust"
    assert body["usage"]["prompt_tokens"] == 10
    assert body["attempts"] == 1


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


def test_lesson_context_fields_are_capped(client: TestClient) -> None:
    ctx = {**CTX, "missedConcepts": ["x"] * 51}
    r = client.post("/v1/pipeline/lesson", json=ctx, headers=TOKEN)
    assert r.status_code == 422
