import copy
import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from learnquest_engine import pipeline
from learnquest_engine.schemas import (
    SCRIM_MAX_SEGMENT_MS,
    SCRIM_MIN_SEGMENT_MS,
    LessonContext,
    ScrimDraft,
    ScrimPart,
    segment_duration_ms,
    timed,
)
from learnquest_engine.server import app
from tests.conftest import FIXTURES
from tests.test_pipeline import CTX

FakeLLM = Callable[[str], list[dict[str, Any]]]
TOKEN = {"X-Engine-Token": "x" * 32}


def raw() -> dict[str, Any]:
    reply = json.loads((FIXTURES / "part_scrim_1.json").read_text())["responses"][0]
    draft: dict[str, Any] = json.loads(reply["choices"][0]["message"]["content"])
    return copy.deepcopy(draft)


def ctx(stretch: int = 0) -> LessonContext:
    lesson = CTX.lesson.model_copy(update={"kind": "scrim"})
    return CTX.model_copy(update={"lesson": lesson, "stretchTests": stretch})


def build(data: dict[str, Any], stretch: int = 0) -> ScrimDraft:
    return ScrimDraft.model_validate(data, context={"stretchTests": stretch})


def rejects(data: dict[str, Any], match: str) -> None:
    with pytest.raises(ValidationError, match=match):
        build(data)


def test_pipeline_times_every_segment_and_keeps_the_gate_steps(fake_llm: FakeLLM) -> None:
    calls = fake_llm("part_scrim_1")
    res = pipeline.lesson(ctx())
    assert isinstance(res.value, ScrimPart)
    assert [s.gate for s in res.value.segments] == [None, 0, None, None]
    assert all(s.durationMs == segment_duration_ms(s.text) for s in res.value.segments)
    assert len(res.value.steps) == 1
    system = calls[0]["messages"][0]["content"]
    assert 'kind is "scrim"' in system
    assert "write no stretch tests" in system


def test_stretch_tests_count_for_the_lab(fake_llm: FakeLLM) -> None:
    fake_llm("part_scrim_1")
    with pytest.raises(AssertionError, match="no recorded reply"):
        pipeline.lesson(ctx(stretch=2))


def test_the_route_returns_durations_and_steps(fake_llm: FakeLLM) -> None:
    fake_llm("part_scrim_1")
    body = ctx().model_dump()
    res = TestClient(app).post("/v1/pipeline/lesson", json=body, headers=TOKEN)
    assert res.status_code == 200
    lesson = res.json()["lesson"]
    assert lesson["kind"] == "scrim"
    assert all(s["durationMs"] >= SCRIM_MIN_SEGMENT_MS for s in lesson["segments"])
    assert lesson["steps"][0]["answer"] == 0


def test_a_gate_must_point_at_a_step() -> None:
    data = raw()
    data["segments"][1]["gate"] = 1
    rejects(data, "exactly one segment")


def test_every_step_needs_a_gate() -> None:
    data = raw()
    del data["segments"][1]["gate"]
    rejects(data, "exactly one segment")


def test_the_last_segment_cannot_be_a_gate() -> None:
    data = raw()
    del data["segments"][1]["gate"]
    data["segments"][-1]["gate"] = 0
    rejects(data, "last segment")


def test_segment_zero_must_show_code() -> None:
    data = raw()
    del data["segments"][0]["edit"]
    rejects(data, "segment 0")


def test_the_lab_must_use_the_scrim_language() -> None:
    data = raw()
    data["lab"]["language"] = "python"
    rejects(data, "lab language")


def test_the_lab_is_checked_like_a_practice_part() -> None:
    data = raw()
    data["lab"]["tests"] = data["lab"]["tests"][:2]
    rejects(data, "required tests")


def test_narration_up_to_the_gate_cannot_state_the_answer() -> None:
    data = raw()
    data["segments"][0]["text"] += " Spoiler: undefined, because nothing is returned."
    rejects(data, "leaks the answer")


def test_narration_after_the_gate_may_state_the_answer() -> None:
    data = raw()
    data["segments"][2]["text"] += " So undefined, because nothing is returned, was right."
    assert build(data).segments[2].gate is None


def test_the_code_at_the_gate_cannot_already_hold_the_change() -> None:
    data = raw()
    data["segments"][1]["edit"]["code"] = "export function add(a, b) {\n  return a + b;\n}\n"
    rejects(data, "already shows the change")


def test_the_code_at_the_gate_cannot_already_hold_part_of_the_change() -> None:
    data = raw()
    data["steps"][0]["hunks"][0]["lines"] = [
        " export function add(a, b) {",
        "-  console.log(a + b);",
        "+  const sum = a + b;",
        "+  console.log(a + b);",
        "+  return sum;",
        " }",
    ]
    rejects(data, "already shows the change")


def test_the_lab_stretch_count_comes_from_the_request() -> None:
    with pytest.raises(ValidationError, match="stretch"):
        build(raw(), stretch=1)


def test_a_draft_without_durations_converts_to_a_part() -> None:
    assert timed(build(raw()), 0).segments[0].durationMs >= SCRIM_MIN_SEGMENT_MS


@given(st.text(max_size=2000))
def test_duration_stays_inside_the_api_bounds(text: str) -> None:
    assert SCRIM_MIN_SEGMENT_MS <= segment_duration_ms(text) <= SCRIM_MAX_SEGMENT_MS


@given(st.lists(st.text(alphabet="abc", min_size=1, max_size=8), max_size=200))
def test_duration_never_shrinks_when_a_word_is_added(words: list[str]) -> None:
    longer = " ".join([*words, "x"])
    assert segment_duration_ms(longer) >= segment_duration_ms(" ".join(words))


@given(st.lists(st.one_of(st.none(), st.integers(0, 2)), min_size=4, max_size=8))
def test_gates_are_valid_only_when_they_run_zero_to_n_in_order(
    gates: list[int | None],
) -> None:
    data = raw()
    segments = data["segments"]
    step = data["steps"][0]
    data["steps"] = [step for _ in range(max([g for g in gates if g is not None], default=-1) + 1)]
    data["steps"] = data["steps"] or [step]
    data["segments"] = [
        {**copy.deepcopy(segments[i % len(segments)]), "gate": g, "text": f"Narration {i}."}
        for i, g in enumerate(gates)
    ]
    data["segments"][0]["edit"] = segments[0]["edit"]
    for segment in data["segments"][1:]:
        segment.pop("edit", None)
    present = [g for g in gates if g is not None]
    expected = (
        gates[-1] is None and present == list(range(len(data["steps"]))) and len(data["steps"]) >= 1
    )
    try:
        build(data)
    except ValidationError:
        assert not expected
    else:
        assert expected
