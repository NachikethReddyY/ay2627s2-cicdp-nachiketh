import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from learnquest_engine.schemas import Lesson, Outline, PredictStep, json_schema

FIXTURES = Path(__file__).parent / "fixtures"
RAW = json.loads((FIXTURES / "lesson1.json").read_text())
PREDICT_SCENARIOS = json.loads((FIXTURES / "predict_scenarios.json").read_text())


def lesson(mutate: Callable[[list[dict[str, Any]]], object]) -> Lesson:
    raw = copy.deepcopy(RAW)
    mutate(raw["steps"])
    return Lesson.model_validate(raw)


def test_fixture_validates() -> None:
    assert len(Lesson.model_validate(RAW).steps) == 3


def test_generated_predict_rejects_ambiguous_union_assignment_cloze() -> None:
    cloze = json.loads((FIXTURES / "ambiguous_union_cloze.json").read_text())
    with pytest.raises(ValidationError) as error:
        lesson(lambda steps: steps.__setitem__(1, {**cloze, "scenario": steps[1]["scenario"]}))

    assert any(
        issue["loc"] == ("steps", 1, "kind") and issue["type"] == "literal_error"
        for issue in error.value.errors()
    )


@pytest.mark.parametrize("case", PREDICT_SCENARIOS, ids=["javascript", "python"])
def test_predict_requires_visible_context(case: dict[str, Any]) -> None:
    step = case["step"]
    assert PredictStep.model_validate(step).scenario == step["scenario"]
    missing = {**step, "prompt": case["hiddenPrompt"]}
    del missing["scenario"]
    with pytest.raises(ValidationError, match="scenario"):
        PredictStep.model_validate(missing)
    with pytest.raises(ValidationError, match="scenario"):
        PredictStep.model_validate({**step, "scenario": " "})
    with pytest.raises(ValidationError, match="hidden edit"):
        PredictStep.model_validate({**step, "prompt": case["hiddenPrompt"]})
    with pytest.raises(ValidationError, match="hidden edit"):
        PredictStep.model_validate({**step, "scenario": case["vagueScenario"]})
    with pytest.raises(ValidationError, match="newly added source lines"):
        PredictStep.model_validate(
            {**step, "scenario": f"Suppose we run `{case['unrevealedLine']}`."}
        )


def test_predict_scenario_cannot_leak_answer() -> None:
    step = PREDICT_SCENARIOS[0]["step"]
    with pytest.raises(ValidationError, match="prediction stem leaks the answer"):
        PredictStep.model_validate({**step, "scenario": "Start with false."})


def test_leak_in_hint() -> None:
    with pytest.raises(ValidationError, match="leak"):
        lesson(lambda s: s[0]["hints"][0].update(text="Use reduce, with the sum starting at 0."))


def test_leak_mcq_option_in_title() -> None:
    with pytest.raises(ValidationError, match="leak"):
        lesson(lambda s: s[0].update(title="Use reduce, with the  sum starting at 0"))


@pytest.mark.parametrize("answer", ["a // b", "x /* y"])
def test_mcq_uses_literal_matching_for_code_options(answer: str) -> None:
    def mutate(steps: list[dict[str, Any]]) -> None:
        steps[1].update(
            options=[answer, "other one", "other two", "other three"],
            answer=0,
            prompt="The values a and b appear in this expression.",
        )

    assert len(lesson(mutate).steps) == 3


def test_mcq_literal_option_in_prompt_is_rejected() -> None:
    def mutate(steps: list[dict[str, Any]]) -> None:
        steps[1].update(
            options=["a // b", "other one", "other two", "other three"],
            answer=0,
            prompt="Enter a // b.",
        )

    with pytest.raises(ValidationError, match="leak"):
        lesson(mutate)


def test_short_mcq_option_does_not_match_an_incidental_letter() -> None:
    def mutate(steps: list[dict[str, Any]]) -> None:
        steps[1].update(
            options=["c", "other one", "other two", "other three"],
            answer=0,
            prompt="What changes?",
        )

    assert len(lesson(mutate).steps) == 3


def test_bad_eliminate() -> None:
    with pytest.raises(ValidationError, match="bad eliminate"):
        lesson(lambda s: s[0]["hints"][0].update(eliminate=1))


def test_wrong_option_count() -> None:
    with pytest.raises(ValidationError):
        lesson(lambda s: s[0]["options"].pop())


def test_too_few_steps() -> None:
    with pytest.raises(ValidationError):
        lesson(lambda s: s.pop())


def test_outline_shapes() -> None:
    assert Outline.model_validate({"refused": True}).refused
    with pytest.raises(ValidationError):
        Outline.model_validate({"title": "x"})


def test_generated_outline_rejects_a_quiz_as_the_first_lesson() -> None:
    lesson = {"title": "Trace a call", "level": 1, "concepts": ["js.functions"], "kind": "predict"}
    course = {
        "title": "Functions",
        "description": "JavaScript",
        "lessons": [
            lesson,
            {**lesson, "title": "Walk through a function call", "kind": "scrim"},
            {**lesson, "title": "Recap: Follow a function call", "kind": "learn"},
            {**lesson, "title": "Code reading check: Trace a call"},
        ],
    }
    data = {"title": "JavaScript", "tagline": "Learn functions", "courses": [course, course]}
    with pytest.raises(ValidationError, match="a Learn introduction"):
        Outline.model_validate(data, context={"learningSequence": True})
    lesson["kind"] = "learn"
    assert Outline.model_validate(data, context={"learningSequence": True}).courses is not None


@pytest.mark.parametrize(
    "kind", ["predict", "learn", "watch", "practice", "game-practice", "scrim"]
)
def test_programming_outline_kinds(kind: str) -> None:
    lesson = {"title": "Return values", "level": 1, "concepts": ["return-values"], "kind": kind}
    course = {"title": "Functions", "description": "JavaScript", "lessons": [lesson] * 3}
    outline = Outline.model_validate(
        {"title": "JavaScript", "tagline": "Learn functions", "courses": [course, course]}
    )
    assert outline.courses is not None
    assert outline.courses[0].lessons[0].kind == kind
    assert "subject" not in json_schema(Outline)["properties"]


def test_json_schema_is_strict() -> None:
    def objects(n: object) -> list[dict[str, object]]:
        if isinstance(n, dict):
            own = [n] if n.get("type") == "object" and "properties" in n else []
            return own + [o for v in n.values() for o in objects(v)]
        if isinstance(n, list):
            return [o for v in n for o in objects(v)]
        return []

    found = objects(json_schema(Lesson))
    assert found
    assert all(o["additionalProperties"] is False for o in found)
