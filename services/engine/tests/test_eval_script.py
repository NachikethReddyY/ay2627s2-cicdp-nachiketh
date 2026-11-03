from collections.abc import Sequence
from pathlib import Path

import pytest

from learnquest_engine.schemas import LearnPart, LessonContext
from scripts import eval_visuals

FIXTURES = Path(__file__).parent / "fixtures"

VALID_DOC = {
    "v": 1,
    "blocks": [{"type": "text", "id": "t", "props": {"md": "A short note."}}],
}


class FakeClient:
    """Stands in for the live model: fixed parts and token counts, no network."""

    name = "fake"

    def __init__(self, replies: Sequence[tuple[LearnPart, int, int]]) -> None:
        self._replies = list(replies)

    def part(self, ctx: LessonContext) -> eval_visuals.Attempt:
        part, prompt, completion = self._replies.pop(0)
        return eval_visuals.Attempt(part, eval_visuals.Tokens(prompt, completion), 1)


def test_topics_cover_thirty_over_six_subjects() -> None:
    assert len(eval_visuals.TOPICS) == 30
    assert len({topic.subject for topic in eval_visuals.TOPICS}) == 6
    assert all(topic.context().lesson.kind == "learn" for topic in eval_visuals.TOPICS)


def test_replay_dry_run_reports_pass_rate_block_mix_and_cost() -> None:
    client = eval_visuals.ReplayClient(sorted(FIXTURES.glob("part_learn*.json")))
    report = eval_visuals.evaluate(eval_visuals.TOPICS, client)

    assert report.total == 30
    # One of the three recorded fixtures carries a schema-valid doc.
    assert report.passed == 10
    assert report.first_try == 10
    assert report.pass_rate == pytest.approx(1 / 3)
    assert report.block_mix["text"] == 10
    assert report.block_mix["chart"] == 10
    assert report.cost_per_part > 0
    # The invalid-doc fixture keeps its part but loses the doc.
    dropped = [r for r in report.results if r.attempt.part is not None and not r.passed]
    assert dropped and all(r.attempt.part is not None for r in dropped)

    text = eval_visuals.format_report(report)
    assert "First-try" in text
    assert "PLACEHOLDER" in text
    assert "Cost per tier" in text


def test_threshold_and_cost_are_computed_from_results() -> None:
    valid = LearnPart(kind="learn", body="x", doc=VALID_DOC)
    missing = LearnPart(kind="learn", body="y")
    client = FakeClient([(valid, 1000, 500), (missing, 1000, 500)])

    report = eval_visuals.evaluate(eval_visuals.TOPICS[:2], client)

    assert (report.passed, report.total) == (1, 2)
    assert report.pass_rate == 0.5
    assert report.meets_threshold is False
    # (1000 * 0.15 + 500 * 0.60) / 1e6, the same for both parts.
    assert report.cost_per_part == pytest.approx(0.00045)
    assert report.cost_per_tier()["free"] == pytest.approx(0.00045)


def test_json_output_marks_placeholders() -> None:
    client = FakeClient([(LearnPart(kind="learn", body="x", doc=VALID_DOC), 10, 5)])
    report = eval_visuals.evaluate(eval_visuals.TOPICS[:1], client)

    data = eval_visuals.to_json(report)

    assert data["threshold"] == {"value": eval_visuals.PASS_THRESHOLD, "placeholder": True}
    assert data["prices_placeholder"]
    assert data["tiers_placeholder"]


def test_live_run_refuses_without_a_key(capsys: pytest.CaptureFixture[str]) -> None:
    assert eval_visuals.main(["--live"]) == 2
    assert "owner-only" in capsys.readouterr().err
