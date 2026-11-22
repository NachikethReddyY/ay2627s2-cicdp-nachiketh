import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from learnquest_engine.schemas import Lesson, Outline, contains_answer, json_schema

FIXTURES = Path(__file__).parent / "fixtures"
RAW = json.loads((FIXTURES / "lesson1.json").read_text())
LEAK_VECTORS = json.loads((FIXTURES / "leak_vectors.json").read_text())


def lesson(mutate: Callable[[list[dict[str, Any]]], object]) -> Lesson:
    raw = copy.deepcopy(RAW)
    mutate(raw["steps"])
    return Lesson.model_validate(raw)


def test_fixture_validates() -> None:
    assert len(Lesson.model_validate(RAW).steps) == 3


def test_leak_in_hint() -> None:
    with pytest.raises(ValidationError, match="leak"):
        lesson(lambda s: s[1]["hints"][0].update(text="It looks like Discount = 0 here."))


def test_leak_mcq_option_in_title() -> None:
    with pytest.raises(ValidationError, match="leak"):
        lesson(lambda s: s[0].update(title="Use reduce, with the  sum starting at 0"))


def test_leak_cloze_answer_in_prompt() -> None:
    with pytest.raises(ValidationError, match="leak"):
        lesson(lambda s: s[1].update(prompt="Type the parameter exactly: discount = 0"))


def test_leak_cloze_answer_in_practice_explanation() -> None:
    with pytest.raises(ValidationError, match="leak"):
        lesson(lambda s: s[1]["explanations"].update(practice="Now write discount = 0."))


def test_leak_cloze_answer_with_other_spacing_in_prompt() -> None:
    def spaced_prompt(steps: list[dict[str, Any]]) -> None:
        steps[1].update(accepted=[], prompt="Fill in the blank with `discount=0`.")

    with pytest.raises(ValidationError, match="leak"):
        lesson(spaced_prompt)


def test_leak_cloze_answer_in_starter_code_comment() -> None:
    def put_hint_in_starter(steps: list[dict[str, Any]]) -> None:
        files = steps[1]["beforeFiles"]
        files["src/cart.js"] = "// Enter discount = 0 in the blank\n" + files["src/cart.js"]

    with pytest.raises(ValidationError, match="leak"):
        lesson(put_hint_in_starter)


def test_leak_cloze_keyword_whole_word_in_prompt() -> None:
    def keyword_cloze(steps: list[dict[str, Any]]) -> None:
        steps[1].update(answer="let", accepted=[], prompt="Use the let keyword to declare it.")

    with pytest.raises(ValidationError, match="leak"):
        lesson(keyword_cloze)


def test_cloze_keyword_inside_longer_word_passes() -> None:
    def keyword_cloze(steps: list[dict[str, Any]]) -> None:
        steps[1].update(
            answer="let",
            accepted=[],
            prompt="Complete the declaration using the block-scoped keyword",
        )

    assert len(lesson(keyword_cloze).steps) == 3


@pytest.mark.parametrize("vector", LEAK_VECTORS, ids=[v["name"] for v in LEAK_VECTORS])
def test_contains_answer_vectors(vector: dict[str, Any]) -> None:
    assert contains_answer(vector["text"], vector["answer"]) is vector["leaks"]


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
