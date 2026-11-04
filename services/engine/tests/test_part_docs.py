from collections.abc import Callable
from typing import Any

from learnquest_engine import pipeline
from learnquest_engine.schemas import GamePracticePart, LearnPart
from tests.test_pipeline import CTX

FakeLLM = Callable[[str], list[dict[str, Any]]]


def ctx(kind: str) -> Any:
    return CTX.model_copy(update={"lesson": CTX.lesson.model_copy(update={"kind": kind})})


def test_valid_game_doc_is_kept_and_catalog_is_in_prompt(fake_llm: FakeLLM) -> None:
    calls = fake_llm("part_game_practice_1")
    res = pipeline.lesson(ctx("game-practice"))
    assert isinstance(res.value, GamePracticePart)
    assert res.value.doc is not None
    assert "### game" in calls[0]["messages"][0]["content"]


def test_invalid_learn_doc_is_dropped_and_body_kept(fake_llm: FakeLLM) -> None:
    fake_llm("part_learn_doc_bad")
    res = pipeline.lesson(ctx("learn"))
    assert isinstance(res.value, LearnPart)
    assert res.value.doc is None
    assert res.value.body.startswith("Variables")
