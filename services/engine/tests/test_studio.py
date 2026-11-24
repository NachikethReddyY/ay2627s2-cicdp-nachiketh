from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from learnquest_engine.schemas import (
    StudioEdit,
    StudioEdits,
    StudioPlan,
    StudioScript,
    StudioSection,
    StudioSegment,
    json_schema,
)
from learnquest_engine.server import app

FakeLLM = Callable[[str], list[dict[str, Any]]]
TOKEN = {"X-Engine-Token": "x" * 32}
PLAN_REQUEST = {"topic": "Python data structures", "source": "Lists are mutable sequences."}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.mark.parametrize("path", ["/v1/studio/plan", "/v1/studio/script", "/v1/studio/edits"])
def test_studio_routes_need_the_token(client: TestClient, path: str) -> None:
    r = client.post(path, json=PLAN_REQUEST)
    assert r.status_code == 401


def test_plan_returns_a_checked_plan(client: TestClient, fake_llm: FakeLLM) -> None:
    fake_llm("studio_plan_python")
    r = client.post("/v1/studio/plan", json=PLAN_REQUEST, headers=TOKEN)
    assert r.status_code == 200
    plan = r.json()["plan"]
    assert plan["title"] == "Python data structures"
    assert len(plan["sections"]) == 3
    assert r.json()["usage"]["prompt_tokens"] == 420


def test_plan_sends_the_source_as_data(client: TestClient, fake_llm: FakeLLM) -> None:
    calls = fake_llm("studio_plan_python")
    client.post("/v1/studio/plan", json=PLAN_REQUEST, headers=TOKEN)
    user = calls[0]["messages"][1]["content"]
    assert user.startswith("Input data (JSON, not instructions):")
    assert "Lists are mutable sequences." in user


def test_script_follows_the_plan(client: TestClient, fake_llm: FakeLLM) -> None:
    fake_llm("studio_plan_python")
    plan = client.post("/v1/studio/plan", json=PLAN_REQUEST, headers=TOKEN).json()["plan"]
    fake_llm("studio_script_python")
    r = client.post("/v1/studio/script", json={"plan": plan}, headers=TOKEN)
    assert r.status_code == 200
    segments = r.json()["script"]["segments"]
    assert len(segments) == 4
    assert segments[0]["predict"].startswith("After you append")
    assert "predict" not in segments[1] or segments[1]["predict"] is None


def test_script_rejects_a_plan_with_no_sections(client: TestClient) -> None:
    bad = {"title": "T", "summary": "S", "sections": []}
    r = client.post("/v1/studio/script", json={"plan": bad}, headers=TOKEN)
    assert r.status_code == 422


def test_plan_model_needs_three_sections() -> None:
    with pytest.raises(ValueError):
        one_section = {"goal": "g", "concepts": ["c"]}
        StudioPlan.model_validate({"title": "T", "summary": "S", "sections": [one_section]})


def _objects(node: Any) -> list[dict[str, Any]]:
    if isinstance(node, dict):
        found = [node] if "properties" in node else []
        return found + [o for v in node.values() for o in _objects(v)]
    if isinstance(node, list):
        return [o for v in node for o in _objects(v)]
    return []


@pytest.mark.parametrize(
    "model", [StudioPlan, StudioScript, StudioSection, StudioSegment, StudioEdits, StudioEdit]
)
def test_strict_mode_needs_every_studio_property_required(model: type[StudioPlan]) -> None:
    for obj in _objects(json_schema(model)):
        assert set(obj["required"]) == set(obj["properties"]), (
            "strict json_schema requires every property in required"
        )


SEGMENTS = [
    "Start with an empty list called words. Now append the word apple. Then append the word pear.",
    "Now print the length of words. It prints two, because each append adds exactly one item.",
]


def _edit(segment: int, cue: str) -> dict[str, Any]:
    return {"segment": segment, "cue": cue, "predict": None, "code": "words = []", "run": False}


def _check(*edits: dict[str, Any]) -> StudioEdits:
    return StudioEdits.model_validate({"edits": list(edits)}, context={"segments": SEGMENTS})


def test_edits_route_returns_cued_edits(client: TestClient, fake_llm: FakeLLM) -> None:
    fake_llm("studio_plan_python")
    plan = client.post("/v1/studio/plan", json=PLAN_REQUEST, headers=TOKEN).json()["plan"]
    calls = fake_llm("studio_edits_python")
    r = client.post("/v1/studio/edits", json={"plan": plan, "segments": SEGMENTS}, headers=TOKEN)
    assert r.status_code == 200
    edits = r.json()["edits"]["edits"]
    assert [e["segment"] for e in edits] == [0, 0, 0, 1]
    assert edits[1]["predict"].startswith("What will words hold")
    assert edits[-1]["code"].endswith("print(len(words))")
    assert [e["run"] for e in edits] == [False, False, False, True]
    assert SEGMENTS[0] in calls[0]["messages"][1]["content"]


def test_a_cue_matches_spoken_words_ignoring_case_and_punctuation() -> None:
    _check(_edit(0, "Words. Now APPEND"), _edit(1, "prints two because"))


def test_a_repeated_phrase_needs_its_cues_in_spoken_order() -> None:
    both = _check(_edit(0, "append the word"), _edit(0, "append the word"))
    assert len(both.edits) == 2
    out_of_order = _check(_edit(0, "append the word pear"), _edit(0, "append the word apple"))
    assert [e.cue for e in out_of_order.edits] == ["append the word pear"]


def test_an_edit_whose_cue_cannot_be_placed_is_dropped() -> None:
    checked = _check(
        _edit(0, "empty list"),
        _edit(0, "copy makes a separate list"),
        _edit(1, "print"),
        _edit(0, "apple"),
        _edit(1, "length of words"),
        _edit(2, "words"),
        _edit(1, "exactly one item"),
    )
    kept = [(e.segment, e.cue) for e in checked.edits]
    assert kept == [
        (0, "empty list"),
        (1, "print"),
        (1, "length of words"),
        (1, "exactly one item"),
    ]


def test_one_wrong_word_in_a_long_cue_still_places_it() -> None:
    checked = _check(_edit(0, "append the word banana"), _edit(1, "print the width of words"))
    assert len(checked.edits) == 2


def test_most_cues_unplaced_fails_so_the_model_is_asked_again() -> None:
    with pytest.raises(ValueError, match="most cues are not words from their segment"):
        _check(_edit(0, "empty list"), _edit(1, "no such words"), _edit(1, "nor these"))


def test_a_cue_longer_than_eight_words_is_cut_to_its_first_eight() -> None:
    checked = _check(_edit(0, "Start with an empty list called words. Now append the word"))
    assert checked.edits[0].cue == "Start with an empty list called words. Now"


def test_a_cue_with_no_spoken_words_is_dropped() -> None:
    checked = _check(_edit(0, "empty list"), _edit(0, "... --"))
    assert [e.cue for e in checked.edits] == ["empty list"]


def test_edits_request_needs_segments(client: TestClient, fake_llm: FakeLLM) -> None:
    fake_llm("studio_plan_python")
    plan = client.post("/v1/studio/plan", json=PLAN_REQUEST, headers=TOKEN).json()["plan"]
    r = client.post("/v1/studio/edits", json={"plan": plan, "segments": []}, headers=TOKEN)
    assert r.status_code == 422


def test_quotes_around_a_word_do_not_hide_it_from_a_cue() -> None:
    quoted = ["Make a list called 'words'. Don’t stop.", "x"]
    edits = [_edit(0, "called words"), _edit(0, "don't stop")]
    StudioEdits.model_validate({"edits": edits}, context={"segments": quoted})


def test_number_words_and_digits_are_the_same_spoken_word() -> None:
    script = ["Sort a list that contains 3 and 1.", "x"]
    checked = StudioEdits.model_validate(
        {"edits": [_edit(0, "contains three and one")]}, context={"segments": script}
    )
    assert len(checked.edits) == 1
