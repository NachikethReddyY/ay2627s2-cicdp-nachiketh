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


def test_photosynthesis_outline_fixture() -> None:
    fixture = Path(__file__).parent / "fixtures" / "outline_photosynthesis.json"
    raw_outline = json.loads(fixture.read_text())
    assert (Outline.model_validate(raw_outline).courses or [])[0].lessons[0].kind == "learn"


def _outline(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((Path(__file__).parent / "fixtures" / name).read_text())
    return data


@pytest.mark.parametrize("kind", ["watch", "practice"])
def test_non_coding_outline_rejects_code_kinds(kind: str) -> None:
    raw = _outline("outline_photosynthesis.json")
    raw["courses"][1]["lessons"][0]["kind"] = kind
    with pytest.raises(ValidationError, match="non-coding outline"):
        Outline.model_validate(raw)


def test_non_coding_outline_allows_learn_and_game_practice() -> None:
    kinds = {
        lesson["kind"]
        for course in _outline("outline_photosynthesis.json")["courses"]
        for lesson in course["lessons"]
    }
    assert kinds == {"learn", "game-practice"}


def test_coding_outline_keeps_watch_and_practice() -> None:
    raw = _outline("outline_photosynthesis.json")
    raw["subject"] = "code"
    raw["courses"][0]["lessons"][1]["kind"] = "watch"
    raw["courses"][0]["lessons"][2]["kind"] = "practice"
    assert Outline.model_validate(raw).subject == "code"


def test_outline_requires_subject() -> None:
    raw = _outline("outline_photosynthesis.json")
    del raw["subject"]
    with pytest.raises(ValidationError, match="subject"):
        Outline.model_validate(raw)


def test_outline_prompt_states_the_non_coding_rule() -> None:
    prompt = (Path(__file__).parent.parent / "learnquest_engine/prompts/outline.md").read_text()
    assert 'subject "other"' in prompt
    assert "only learn or game-practice" in prompt


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
