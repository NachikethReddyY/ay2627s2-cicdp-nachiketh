from typing import Any

import litellm
import pytest
from fastapi.testclient import TestClient

from learnquest_engine.server import app

TOKEN = {"X-Engine-Token": "x" * 32}

UPDATE = {
    "priors": [{"conceptId": "vars", "pKnown": 0.2}, {"conceptId": "loops", "pKnown": None}],
    "questionType": "mcq",
    "correct": True,
}
NEXT = {
    "mastery": [{"conceptId": "vars", "pKnown": 0.3}],
    "edges": [],
    "lessons": [
        {"lessonId": "l1", "conceptIds": ["vars"], "kind": "learn", "done": False, "order": 1}
    ],
}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def no_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(**_: Any) -> None:
        raise AssertionError("learner routes must not call the LLM")

    monkeypatch.setattr(litellm, "completion", boom)


@pytest.mark.parametrize("path", ["/v1/mastery/update", "/v1/next"])
@pytest.mark.parametrize("headers", [{}, {"X-Engine-Token": "y" * 32}])
def test_token_required(client: TestClient, path: str, headers: dict[str, str]) -> None:
    assert client.post(path, json={}, headers=headers).status_code == 401


def test_update_shape(client: TestClient) -> None:
    r = client.post("/v1/mastery/update", json=UPDATE, headers=TOKEN)
    assert r.status_code == 200
    updates = r.json()["updates"]
    assert [u["conceptId"] for u in updates] == ["vars", "loops"]
    assert updates[0]["pPosterior"] == pytest.approx(0.474, abs=0.01)
    assert updates[0]["pNext"] == pytest.approx(0.579, abs=0.01)
    assert updates[1]["pNext"] == updates[0]["pNext"]  # null prior falls back to pInit 0.2


def test_update_cloze_guess_default(client: TestClient) -> None:
    body = {**UPDATE, "questionType": "cloze"}
    mcq = client.post("/v1/mastery/update", json=UPDATE, headers=TOKEN).json()
    cloze = client.post("/v1/mastery/update", json=body, headers=TOKEN).json()
    assert cloze["updates"][0]["pPosterior"] > mcq["updates"][0]["pPosterior"]


@pytest.mark.parametrize("params", [{"pSlip": 0.7}, {"pSlip": 0}, {"pGuess": 0.5}])
def test_update_bad_params_422(client: TestClient, params: dict[str, float]) -> None:
    r = client.post("/v1/mastery/update", json={**UPDATE, "params": params}, headers=TOKEN)
    assert r.status_code == 422


def test_update_bad_body_422(client: TestClient) -> None:
    r = client.post("/v1/mastery/update", json={**UPDATE, "questionType": "essay"}, headers=TOKEN)
    assert r.status_code == 422


def test_next_shape(client: TestClient) -> None:
    r = client.post("/v1/next", json=NEXT, headers=TOKEN)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"action", "lessonId", "conceptId", "reasonCode", "reason"}
    assert body["action"] == "learn"
    assert body["lessonId"] == "l1"
    assert body["reasonCode"] == "LEARN"
    assert body["reason"]


def test_next_done_has_null_lesson(client: TestClient) -> None:
    done = {**NEXT, "lessons": [{**NEXT["lessons"][0], "done": True}]}  # type: ignore[index]
    body = client.post("/v1/next", json=done, headers=TOKEN).json()
    assert body["action"] == "done"
    assert body["lessonId"] is None
    assert body["reason"]


def test_next_reason_uses_titles(client: TestClient) -> None:
    body = {
        "mastery": [],
        "lessons": [
            {
                "lessonId": "l1",
                "conceptIds": ["vars"],
                "kind": "learn",
                "done": False,
                "order": 1,
                "title": "Variables",
            }
        ],
        "worldTitle": "JavaScript Basics",
    }
    reason = client.post("/v1/next", json=body, headers=TOKEN).json()["reason"]
    assert "JavaScript Basics" in reason
    assert "Variables" in reason
