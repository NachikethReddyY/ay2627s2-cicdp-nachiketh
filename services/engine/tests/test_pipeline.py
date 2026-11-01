from collections.abc import Callable
from typing import Any

from learnquest_engine import pipeline
from learnquest_engine.schemas import Lesson, LessonContext, Outline

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
