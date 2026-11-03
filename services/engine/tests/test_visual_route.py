import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from learnquest_engine import visual
from learnquest_engine.llm import Result
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
    # The first reply is invalid, so the route makes one repair call; the repair is also invalid.
    calls = fake_llm("visual_bad_repair")
    r = client.post("/v1/pipeline/visual", json={"prompt": "pets chart"}, headers=TOKEN)
    assert r.status_code == 422
    assert r.json()["issues"]
    assert len(calls) == 2
    assert "fix_these_issues" in calls[1]["messages"][-1]["content"]


def _stage(path_y: float) -> dict[str, Any]:
    step = [{"caption": "c", "durationMs": 1000, "ease": "power2.inOut"}]
    return {
        "v": 1,
        "blocks": [
            {
                "type": "stage",
                "id": "s",
                "props": {
                    "alt": "A dot rides a curve",
                    "shapes": [
                        {"id": "p", "kind": "path", "x": 10, "y": path_y, "d": "M 0 50 L 100 50"},
                        {"id": "dot", "kind": "circle", "x": 10, "y": 50, "r": 4, "fill": "sun"},
                    ],
                    "timeline": {
                        "steps": [
                            {**step[0], "set": []},
                            {**step[0], "set": [{"id": "dot", "prop": "x", "value": 85}]},
                            {**step[0], "set": [{"id": "dot", "prop": "y", "value": 40}]},
                        ]
                    },
                },
            }
        ],
    }


def _fake_generate(
    monkeypatch: pytest.MonkeyPatch, docs: list[dict[str, Any]]
) -> list[list[str] | None]:
    """Replace the model call with canned docs; returns the repair argument of each call."""
    repairs: list[list[str] | None] = []

    def fake(
        prompt: str, repair: list[str] | None = None, previous: dict[str, Any] | None = None
    ) -> Result[visual.VisualDoc]:
        repairs.append(repair)
        doc = visual.VisualDoc.model_validate(docs[len(repairs) - 1])
        return Result(doc, {"prompt_tokens": 0, "completion_tokens": 0, "model": "t"}, 1)

    monkeypatch.setattr(visual, "generate_visual", fake)
    monkeypatch.setattr(visual, "ts_issues", lambda _doc: [])  # schema-only; no node needed
    return repairs


def test_repair_pass_fixes_out_of_range_value(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    good = _stage(path_y=50)
    repairs = _fake_generate(monkeypatch, [_stage(path_y=-10), good])
    r = client.post("/v1/pipeline/visual", json={"prompt": "dot on a curve"}, headers=TOKEN)
    assert r.status_code == 200
    assert r.json()["doc"] == good
    assert repairs[0] is None
    assert repairs[1] and any("-10" in i and "minimum" in i for i in repairs[1])


def test_repair_pass_still_invalid_is_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    repairs = _fake_generate(monkeypatch, [_stage(path_y=-10), _stage(path_y=-5)])
    r = client.post("/v1/pipeline/visual", json={"prompt": "dot on a curve"}, headers=TOKEN)
    assert r.status_code == 422
    assert any("-5 is less" in i for i in r.json()["issues"])
    assert len(repairs) == 2


def test_repair_call_sends_previous_document(fake_llm: FakeLLM) -> None:
    # The repair must correct the first document, so its JSON has to reach the model.
    calls = fake_llm("visual_bad_repair")
    doc = {"v": 1, "blocks": [{"type": "chart", "id": "x", "props": {"kind": "bar"}}]}
    visual.generate_visual("pets chart", ["/blocks/0: missing data"], doc)
    content = calls[0]["messages"][-1]["content"]
    assert json.dumps(doc) in content
    assert "/blocks/0: missing data" in content


def test_unconfigured_llm_is_clear(monkeypatch: pytest.MonkeyPatch) -> None:
    r = TestClient(app).post("/v1/pipeline/visual", json={"prompt": "x"}, headers=TOKEN)
    assert r.status_code == 503
    assert r.json()["error"] == "LLM not configured (LLM_API_KEY is empty)"


def test_needs_token(client: TestClient) -> None:
    assert client.post("/v1/pipeline/visual", json={"prompt": "x"}).status_code == 401


def test_checker_unavailable_fails_closed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fake_generate(monkeypatch, [_stage(path_y=50)])

    def unavailable(_doc: dict[str, Any]) -> list[str]:
        raise visual.CheckerUnavailable("node missing")

    monkeypatch.setattr(visual, "ts_issues", unavailable)
    r = client.post("/v1/pipeline/visual", json={"prompt": "dot on a curve"}, headers=TOKEN)
    assert r.status_code == 503
    assert "doc" not in r.json()
