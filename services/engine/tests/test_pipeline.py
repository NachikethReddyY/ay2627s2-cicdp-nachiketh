import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import litellm
import pytest

from learnquest_engine import pipeline
from learnquest_engine.schemas import (
    GamePracticePart,
    LearnPart,
    Lesson,
    LessonContext,
    Outline,
    PracticePart,
    WatchPart,
)

CTX = LessonContext.model_validate(
    {
        "path": {"title": "Learn Rust", "tagline": "From ownership to traits"},
        "course": {"title": "Basics", "description": "Variables and functions"},
        "lesson": {"title": "Variables", "level": 1, "concepts": ["let", "mut"]},
        "missedConcepts": [],
    }
)


def test_outline_returns_validated_model(fake_llm: Callable[[str], list[dict[str, Any]]]) -> None:
    calls = fake_llm("outline_rust")
    res = pipeline.outline("rust")
    assert isinstance(res.value, Outline)
    assert res.value.title == "Learn Rust"
    assert res.usage["prompt_tokens"] == 10
    assert "rust" in calls[0]["messages"][1]["content"]


def test_lesson_returns_validated_model(fake_llm: Callable[[str], list[dict[str, Any]]]) -> None:
    fake_llm("lesson_rust_1")
    res = pipeline.lesson(CTX)
    assert isinstance(res.value, Lesson)
    assert len(res.value.steps) >= 3
    assert res.attempts == 1


def test_lesson_repairs_once(fake_llm: Callable[[str], list[dict[str, Any]]]) -> None:
    calls = fake_llm("lesson_invalid_then_fixed")
    res = pipeline.lesson(CTX)
    assert res.attempts == 2
    assert res.usage["prompt_tokens"] == 20
    assert len(calls) == 2


@pytest.mark.parametrize(
    ("kind", "fixture", "model"),
    [
        ("learn", "part_learn_1", LearnPart),
        ("watch", "part_watch_1", WatchPart),
        ("practice", "part_practice_1", PracticePart),
    ],
)
def test_part_uses_its_kind_model(
    fake_llm: Callable[[str], list[dict[str, Any]]], kind: str, fixture: str, model: type
) -> None:
    fake_llm(fixture)
    ctx = CTX.model_copy(update={"lesson": CTX.lesson.model_copy(update={"kind": kind})})
    res = pipeline.lesson(ctx)
    assert isinstance(res.value, model)
    assert res.value.kind == kind


def test_game_practice_repairs_a_grid_the_checker_rejects(monkeypatch: pytest.MonkeyPatch) -> None:
    fixture_path = Path(__file__).parent / "fixtures" / "part_game_practice_1.json"
    fixture = json.loads(fixture_path.read_text())
    valid = fixture["responses"][0]
    original = json.loads(valid["choices"][0]["message"]["content"])
    bad = json.loads(json.dumps(original))
    bad["doc"]["blocks"][0]["props"]["kind"]["walls"].append({"x": 1, "y": 0})
    bad_reply = {
        **valid,
        "choices": [
            {**valid["choices"][0], "message": {"role": "assistant", "content": json.dumps(bad)}}
        ],
    }
    replies = iter([bad_reply, valid])
    calls: list[dict[str, Any]] = []

    def completion(**kwargs: Any) -> Any:
        calls.append(kwargs)
        return litellm.ModelResponse(**next(replies))

    monkeypatch.setattr(litellm, "completion", completion)
    ctx = CTX.model_copy(update={"lesson": CTX.lesson.model_copy(update={"kind": "game-practice"})})
    result = pipeline.lesson(ctx)
    assert isinstance(result.value, GamePracticePart)
    assert result.value.doc == original["doc"]
    assert result.attempts == 2
    assert result.usage["prompt_tokens"] == 20
    payload = json.loads(calls[1]["messages"][1]["content"].split("\n", 1)[1])
    assert payload["previous_part"]["doc"] == bad["doc"]
    assert payload["fix_these_issues"]
