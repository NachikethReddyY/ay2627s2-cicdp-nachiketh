import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from learnquest_engine.schemas import Lesson, Outline, json_schema

RAW = json.loads((Path(__file__).parent / "fixtures" / "lesson1.json").read_text())


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


def test_rust_outline_fixture() -> None:
    raw = _outline("outline_rust.json")
    content = json.loads(raw["responses"][0]["choices"][0]["message"]["content"])
    assert (Outline.model_validate(content).courses or [])[0].lessons[0].kind == "learn"


def _outline(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((Path(__file__).parent / "fixtures" / name).read_text())
    return data


def test_outline_allows_predict_lessons() -> None:
    lesson = {"title": "Return values", "level": 1, "concepts": ["return values"]}
    lesson["kind"] = "predict"
    course = {"title": "Functions", "description": "d", "lessons": [lesson] * 3}
    outline = Outline.model_validate({"title": "T", "tagline": "t", "courses": [course, course]})
    assert (outline.courses or [])[0].lessons[0].kind == "predict"


def test_outline_has_no_subject_field() -> None:
    assert "subject" not in Outline.model_fields
    assert "subject" not in json.dumps(Outline.model_json_schema())


def test_outline_prompt_is_programming_only() -> None:
    path = Path(__file__).parent.parent / "learnquest_engine/prompts/outline.md"
    prompt = path.read_text().lower()
    for word in ("school", "subject", "non-coding", "other subjects"):
        assert word not in prompt
    assert "predict" in prompt


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
