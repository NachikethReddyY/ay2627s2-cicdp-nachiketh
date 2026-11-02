from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from learnquest_engine.server import app

TOKEN = {"X-Engine-Token": "x" * 32}
FakeLLM = Callable[[str], list[dict[str, Any]]]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("LLM_API_KEY", "test-key-not-real")
    from learnquest_engine.config import get_settings

    get_settings.cache_clear()
    return TestClient(app)


def test_valid_doc_passes(client: TestClient, fake_llm: FakeLLM) -> None:
    calls = fake_llm("visual_ok")
    r = client.post("/v1/pipeline/visual", json={"prompt": "pets chart"}, headers=TOKEN)
    assert r.status_code == 200
    assert r.json()["doc"]["v"] == 1
    assert "Never make images" in calls[0]["messages"][0]["content"]


def test_invalid_doc_is_rejected(client: TestClient, fake_llm: FakeLLM) -> None:
    fake_llm("visual_bad")
    r = client.post("/v1/pipeline/visual", json={"prompt": "pets chart"}, headers=TOKEN)
    assert r.status_code == 422
    assert r.json()["issues"]


def test_unconfigured_llm_is_clear(monkeypatch: pytest.MonkeyPatch) -> None:
    r = TestClient(app).post("/v1/pipeline/visual", json={"prompt": "x"}, headers=TOKEN)
    assert r.status_code == 503
    assert r.json()["error"] == "LLM not configured (LLM_API_KEY is empty)"


def test_needs_token(client: TestClient) -> None:
    assert client.post("/v1/pipeline/visual", json={"prompt": "x"}).status_code == 401
