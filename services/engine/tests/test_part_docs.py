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


def test_part_prompt_puts_the_doc_in_the_doc_field(fake_llm: FakeLLM) -> None:
    calls = fake_llm("part_game_practice_1")
    pipeline.lesson(ctx("game-practice"))
    system = calls[0]["messages"][0]["content"]
    assert "Put it inside the `doc` field" in system
    assert "Return ONE JSON object shaped" not in system


def test_visual_route_prompt_is_unchanged() -> None:
    from learnquest_engine import visual

    assert "Return ONE JSON object shaped" in visual._system()
    assert "`doc` field" not in visual._system()


def test_game_doc_semantic_failure_gets_one_repair_then_422(
    fake_llm: FakeLLM, monkeypatch: Any
) -> None:
    import pytest

    from learnquest_engine import visual

    calls = fake_llm("part_game_practice_1")
    monkeypatch.setattr(visual, "ts_issues", lambda doc: ["grid: unsolvable"])
    # The fixture has one reply; a second call must fail the test loudly if the repair is skipped.
    with pytest.raises(AssertionError, match="no recorded reply"):
        pipeline.lesson(ctx("game-practice"))
    assert len(calls) == 2
    assert "grid: unsolvable" in calls[1]["messages"][1]["content"]


def test_game_checker_unavailable_fails_closed(fake_llm: FakeLLM, monkeypatch: Any) -> None:
    import pytest

    from learnquest_engine import visual

    fake_llm("part_game_practice_1")

    def boom(doc: Any) -> list[str]:
        raise visual.CheckerUnavailable("no node")

    monkeypatch.setattr(visual, "ts_issues", boom)
    with pytest.raises(visual.CheckerUnavailable):
        pipeline.lesson(ctx("game-practice"))
