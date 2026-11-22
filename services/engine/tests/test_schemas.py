import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from learnquest_engine.answer_leak import contains_answer, scan_tokens
from learnquest_engine.schemas import Lesson, Outline, json_schema

FIXTURES = Path(__file__).parent / "fixtures"
RAW = json.loads((FIXTURES / "lesson1.json").read_text())
LEAK_VECTORS = json.loads((FIXTURES / "leak_vectors.json").read_text())
TRIM_VECTORS = json.loads((FIXTURES / "cloze_trim_vectors.json").read_text())


def lesson(mutate: Callable[[list[dict[str, Any]]], object]) -> Lesson:
    raw = copy.deepcopy(RAW)
    mutate(raw["steps"])
    return Lesson.model_validate(raw)


def test_fixture_validates() -> None:
    assert len(Lesson.model_validate(RAW).steps) == 3


@pytest.mark.parametrize("vector", TRIM_VECTORS, ids=[v["name"] for v in TRIM_VECTORS])
def test_cloze_schema_trim_vectors(vector: dict[str, Any]) -> None:
    if vector["expected"] is None:
        with pytest.raises(ValidationError):
            lesson(_cloze(answer=vector["input"], accepted=[vector["input"]]))
        return
    parsed = lesson(_cloze(answer=vector["input"], accepted=[vector["input"]]))
    cloze = parsed.steps[1]
    assert cloze.answer == vector["expected"]
    assert cloze.accepted == [vector["expected"]]


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


def test_case_changes_in_starter_code_do_not_match_cloze_tokens() -> None:
    parsed = lesson(_cloze(answer="discount = 0", beforeFiles={"src/cart.js": "DISCOUNT = 0"}))
    assert len(parsed.steps) == 3


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


def _cloze(**changes: Any) -> Callable[[list[dict[str, Any]]], None]:
    def mutate(steps: list[dict[str, Any]]) -> None:
        steps[1].update({"accepted": [], **changes})

    return mutate


@pytest.mark.parametrize(
    ("answer", "prompt"),
    [
        ("discount = 0", "Enter `discount /*x*/ = 0` in the blank."),
        ("discount = 0", "Enter discount //x\n= 0 in the blank."),
        ("discount /*x*/ = 0", "Enter `discount=0` in the blank."),
        ("- 1", "Type `- 1`."),
        ("if", "Start with if you want to branch."),
        ("of", "Say of course."),
        ("1", "Type 1 here."),
        ("_", "Type _ here."),
    ],
)
def test_leak_cloze_answer_matches_grader_tokens(answer: str, prompt: str) -> None:
    with pytest.raises(ValidationError, match="leak"):
        lesson(_cloze(answer=answer, prompt=prompt))


@pytest.mark.parametrize(
    ("answer", "prompt"),
    [
        ("if", "Compare the diff."),
        ("of", "We offer a hint."),
        ("1", "Type 10 here."),
        ("_", "Type snake_case here."),
        ("discount = 0", "Type discount=01 here."),
        ('"a b"', 'Type "ab" here.'),
    ],
)
def test_cloze_tokens_the_grader_keeps_apart_pass(answer: str, prompt: str) -> None:
    def mutate(steps: list[dict[str, Any]]) -> None:
        _cloze(answer=answer, prompt=prompt)(steps)
        steps[1]["explanations"]["workedExample"] = "Watch how the subtotal is scaled."

    assert len(lesson(mutate).steps) == 3


@pytest.mark.parametrize("answer", ["a // b", "x /* y"])
def test_mcq_uses_literal_matching_for_code_options(answer: str) -> None:
    def mutate(steps: list[dict[str, Any]]) -> None:
        steps[1].update(
            kind="mcq",
            options=[answer, "other one", "other two", "other three"],
            answer=0,
            prompt="The values a and b appear in this expression.",
        )
        steps[1].pop("accepted", None)

    assert len(lesson(mutate).steps) == 3


def test_mcq_literal_option_in_prompt_is_rejected() -> None:
    def mutate(steps: list[dict[str, Any]]) -> None:
        steps[1].update(
            kind="mcq",
            options=["a // b", "other one", "other two", "other three"],
            answer=0,
            prompt="Enter a // b.",
        )
        steps[1].pop("accepted", None)

    with pytest.raises(ValidationError, match="leak"):
        lesson(mutate)


def test_short_mcq_option_does_not_match_an_incidental_letter() -> None:
    def mutate(steps: list[dict[str, Any]]) -> None:
        steps[1].update(
            kind="mcq",
            options=["c", "other one", "other two", "other three"],
            answer=0,
            prompt="What changes?",
        )
        steps[1].pop("accepted", None)

    assert len(lesson(mutate).steps) == 3


def test_scan_tokens_follows_the_grader() -> None:
    tokens, nested = scan_tokens("a /*x*/ b//y\n'c d' 0.5 \u0085")
    assert tokens == ["a", "b", "'c d'", "0.5", "\u0085"]
    assert nested == ["x", "y", "c d"]


def test_scan_tokens_unterminated_spans_run_to_the_end() -> None:
    assert scan_tokens('a "b c') == (["a", '"b c'], ["b c"])
    assert scan_tokens("a /* b c") == (["a"], [" b c"])
    assert scan_tokens('a "b\\') == (["a", '"b\\'], ["b\\"])


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
