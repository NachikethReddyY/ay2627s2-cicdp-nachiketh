"""Quality eval for generated visual documents: 30 topics across 6 subjects.

Default mode replays recorded fixtures and makes no model calls. A live run (`--live`) is
owner-only: it needs LLM_MODEL, LLM_API_KEY and ENGINE_TOKEN in services/engine/.env and
spends real money. See docs/evals/README.md.

  uv run python scripts/eval_visuals.py                     # offline dry run on fixtures
  uv run python scripts/eval_visuals.py --live --json-out docs/evals/latest.json

The pass/fail threshold, token prices and per-tier limits below are PLACEHOLDERS for the
owner; they are printed as such and are not a quality claim about any model.
"""

import argparse
import json
import sys
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from pydantic import ValidationError

from learnquest_engine import pipeline, visual
from learnquest_engine.config import get_settings
from learnquest_engine.llm import GenerationError
from learnquest_engine.schemas import LearnPart, LessonContext

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"

# PLACEHOLDER: the owner confirms the bar. The plan's provisional target is 85% first-try
# before two-step generation is considered.
PASS_THRESHOLD = 0.85

# PLACEHOLDER: owner replaces with real provider prices and the LQ-63 tier numbers.
TIER_VISUALS_PER_DAY = {"free": 1, "pro": 4, "max": 10}


@dataclass(frozen=True)
class Prices:
    """USD per million tokens; PLACEHOLDER values until the owner sets the real ones."""

    input_usd_per_million: float = 0.15
    output_usd_per_million: float = 0.60

    def cost(self, tokens: "Tokens") -> float:
        return (
            tokens.prompt * self.input_usd_per_million
            + tokens.completion * self.output_usd_per_million
        ) / 1_000_000


# PLACEHOLDER prices, read once so the eval default is a stable singleton.
DEFAULT_PRICES = Prices()


@dataclass(frozen=True)
class Topic:
    subject: str
    title: str
    course: str
    concepts: tuple[str, ...]

    def context(self) -> LessonContext:
        return LessonContext.model_validate(
            {
                "path": {
                    "title": f"Explore {self.subject}",
                    "tagline": f"Five lessons in {self.subject}",
                },
                "course": {"title": self.course, "description": f"An intro to {self.course}"},
                "lesson": {
                    "title": self.title,
                    "level": 1,
                    "concepts": list(self.concepts),
                    "kind": "learn",
                },
                "missedConcepts": [],
            }
        )


def _subject(name: str, course: str, lessons: Sequence[tuple[str, tuple[str, ...]]]) -> list[Topic]:
    return [Topic(name, title, course, concepts) for title, concepts in lessons]


TOPICS: tuple[Topic, ...] = tuple(
    _subject("coding", "First steps in code", [
        ("Variables and types", ("variable", "type")),
        ("Loops that count", ("loop", "iteration")),
        ("Functions and return values", ("function", "return")),
        ("Lists and indexing", ("list", "index")),
        ("Debugging a traceback", ("error", "traceback")),
    ])
    + _subject("math", "Everyday numbers", [
        ("Fractions on a number line", ("fraction", "number line")),
        ("Area and perimeter", ("area", "perimeter")),
        ("Mean, median and mode", ("mean", "median", "mode")),
        ("Slope of a line", ("slope", "line")),
        ("Probability of two events", ("probability", "event")),
    ])
    + _subject("science", "How the world works", [
        ("Photosynthesis", ("chlorophyll", "glucose")),
        ("The water cycle", ("evaporation", "condensation")),
        ("Newton's second law", ("force", "acceleration")),
        ("Plate tectonics", ("plate", "earthquake")),
        ("The rock cycle", ("igneous", "sedimentary")),
    ])
    + _subject("history", "Turning points", [
        ("The Silk Road", ("trade", "caravan")),
        ("The printing press", ("movable type", "literacy")),
        ("The Industrial Revolution", ("steam", "factory")),
        ("The Moon landing", ("Apollo", "lunar module")),
        ("The fall of the Berlin Wall", ("cold war", "reunification")),
    ])
    + _subject("language", "Writing clearly", [
        ("Subject-verb agreement", ("subject", "verb")),
        ("Irregular past tense", ("past tense", "irregular")),
        ("Figurative language", ("metaphor", "simile")),
        ("Paragraph structure", ("topic sentence", "support")),
        ("Cognates in Spanish", ("cognate", "vocabulary")),
    ])
    + _subject("economics", "Money basics", [
        ("Supply and demand", ("supply", "demand")),
        ("Compound interest", ("interest", "principal")),
        ("Opportunity cost", ("trade-off", "choice")),
        ("Inflation", ("price level", "purchasing power")),
        ("Budgeting a paycheck", ("income", "expense")),
    ])
)


@dataclass(frozen=True)
class Tokens:
    prompt: int = 0
    completion: int = 0


@dataclass(frozen=True)
class Attempt:
    part: LearnPart | None
    tokens: Tokens
    attempts: int
    error: str | None = None


class Client(Protocol):
    name: str

    def part(self, ctx: LessonContext) -> Attempt: ...


def _gate(part: LearnPart) -> LearnPart:
    # Same check pipeline.lesson applies: an invalid doc is dropped, the body is kept.
    return part.model_copy(update={"doc": visual.validated(part.doc)})


class ReplayClient:
    """Replay recorded completion fixtures in order. Never touches the network."""

    def __init__(self, fixtures: Sequence[Path]) -> None:
        if not fixtures:
            raise ValueError("no fixtures to replay")
        self._fixtures = list(fixtures)
        self._next = 0

    @property
    def name(self) -> str:
        return f"replay ({len(self._fixtures)} recorded fixtures, no model calls)"

    def part(self, ctx: LessonContext) -> Attempt:
        path = self._fixtures[self._next % len(self._fixtures)]
        self._next += 1
        responses = json.loads(path.read_text("utf-8"))["responses"]
        tokens = Tokens()
        error = f"{path.name}: no recorded response"
        for n, response in enumerate(responses, start=1):
            usage = response.get("usage") or {}
            tokens = Tokens(
                tokens.prompt + int(usage.get("prompt_tokens") or 0),
                tokens.completion + int(usage.get("completion_tokens") or 0),
            )
            content = response["choices"][0]["message"]["content"]
            try:
                part = LearnPart.model_validate(json.loads(content))
            except (ValidationError, json.JSONDecodeError, KeyError, TypeError) as exc:
                error = f"{path.name}: {exc}"
                continue
            return Attempt(_gate(part), tokens, n)
        return Attempt(None, tokens, len(responses), error)


class LiveClient:
    """Call the configured model. OWNER-ONLY: spends real money and needs a real key."""

    def __init__(self) -> None:
        self.name = f"live ({get_settings().LLM_MODEL})"

    def part(self, ctx: LessonContext) -> Attempt:
        try:
            res = pipeline.lesson(ctx)
        except GenerationError as exc:
            return Attempt(None, Tokens(), 2, exc.errors)
        tokens = Tokens(res.usage["prompt_tokens"], res.usage["completion_tokens"])
        if not isinstance(res.value, LearnPart):
            name = type(res.value).__name__
            return Attempt(None, tokens, res.attempts, f"unexpected part {name}")
        return Attempt(res.value, tokens, res.attempts)


@dataclass(frozen=True)
class Result:
    topic: Topic
    attempt: Attempt

    @property
    def passed(self) -> bool:
        return self.attempt.part is not None and self.attempt.part.doc is not None

    @property
    def first_try(self) -> bool:
        return self.passed and self.attempt.attempts == 1


@dataclass(frozen=True)
class Report:
    results: tuple[Result, ...]
    client: str
    prices: Prices
    tiers: dict[str, int]
    threshold: float

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(r.passed for r in self.results)

    @property
    def first_try(self) -> int:
        return sum(r.first_try for r in self.results)

    @property
    def pass_rate(self) -> float:
        return self.passed / self.total if self.total else 0.0

    @property
    def first_try_rate(self) -> float:
        return self.first_try / self.total if self.total else 0.0

    @property
    def meets_threshold(self) -> bool:
        return self.first_try_rate >= self.threshold

    @property
    def block_mix(self) -> Counter[str]:
        mix: Counter[str] = Counter()
        for result in self.results:
            doc = result.attempt.part.doc if result.attempt.part else None
            for block in (doc or {}).get("blocks", []):
                if isinstance(block, dict):
                    mix[str(block.get("type", "unknown"))] += 1
        return mix

    @property
    def cost_per_part(self) -> float:
        return sum(self.prices.cost(r.attempt.tokens) for r in self.results) / self.total

    def cost_per_tier(self) -> dict[str, float]:
        """Daily USD for one user at each tier's PLACEHOLDER visual budget."""
        return {tier: self.cost_per_part * per_day for tier, per_day in self.tiers.items()}

    @property
    def skipped(self) -> int:
        """Topics with no part at all (a generation or validation failure)."""
        return sum(r.attempt.part is None for r in self.results)


def evaluate(
    topics: Sequence[Topic],
    client: Client,
    *,
    prices: Prices = DEFAULT_PRICES,
    tiers: dict[str, int] = TIER_VISUALS_PER_DAY,
    threshold: float = PASS_THRESHOLD,
) -> Report:
    return Report(
        results=tuple(Result(topic, client.part(topic.context())) for topic in topics),
        client=client.name,
        prices=prices,
        tiers=tiers,
        threshold=threshold,
    )


def format_report(report: Report) -> str:
    lines = [
        f"Visual generation eval ({report.client})",
        "",
        f"Parts: {report.total}  passed: {report.passed}  skipped: {report.skipped}",
        f"Pass rate: {report.pass_rate:.1%}",
        f"First-try pass rate: {report.first_try_rate:.1%}",
        (
            f"Threshold: {report.threshold:.1%} [PLACEHOLDER, owner decides] -> "
            f"{'met' if report.meets_threshold else 'not met'}"
        ),
        "",
        "Block mix: " + (", ".join(f"{k} {v}" for k, v in sorted(report.block_mix.items())) or "-"),
        "",
        (
            f"Cost per part: ${report.cost_per_part:.6f} "
            f"[PLACEHOLDER prices ${report.prices.input_usd_per_million:.2f}/"
            f"${report.prices.output_usd_per_million:.2f} per 1M tokens]"
        ),
        "Cost per tier per user [PLACEHOLDER limits]:",
    ]
    for tier, daily in report.cost_per_tier().items():
        per_day = report.tiers[tier]
        lines.append(f"  {tier} ({per_day}/day): ${daily:.6f}/day ${daily * 30:.6f}/30 days")
    lines += [
        "",
        "Recorded fixtures measure the harness, not model quality. The live run is owner-only.",
    ]
    return "\n".join(lines)


def to_json(report: Report) -> dict[str, object]:
    return {
        "client": report.client,
        "total": report.total,
        "passed": report.passed,
        "first_try": report.first_try,
        "skipped": report.skipped,
        "pass_rate": report.pass_rate,
        "first_try_rate": report.first_try_rate,
        "threshold": {"value": report.threshold, "placeholder": True},
        "meets_threshold": report.meets_threshold,
        "block_mix": dict(report.block_mix),
        "cost_per_part_usd": report.cost_per_part,
        "prices_placeholder": {
            "input_usd_per_million": report.prices.input_usd_per_million,
            "output_usd_per_million": report.prices.output_usd_per_million,
        },
        "tiers_placeholder": report.tiers,
        "cost_per_tier_usd_per_day": report.cost_per_tier(),
        "parts": [
            {
                "subject": r.topic.subject,
                "title": r.topic.title,
                "passed": r.passed,
                "attempts": r.attempt.attempts,
                "error": r.attempt.error,
            }
            for r in report.results
        ],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Quality eval for generated visual documents.")
    parser.add_argument(
        "--live",
        action="store_true",
        help="call the configured model (OWNER-ONLY: needs LLM_API_KEY, spends money)",
    )
    parser.add_argument("--fixtures", type=Path, default=FIXTURES)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--price-input", type=float, default=None)
    parser.add_argument("--price-output", type=float, default=None)
    parser.add_argument("--json-out", type=Path, default=None)
    args = parser.parse_args(argv)

    topics = TOPICS[: args.limit] if args.limit is not None else TOPICS
    client: Client
    if args.live:
        try:
            client = LiveClient()
        except ValidationError:
            print(
                "owner-only: set LLM_MODEL, LLM_API_KEY and ENGINE_TOKEN in services/engine/.env",
                file=sys.stderr,
            )
            return 2
        if not get_settings().LLM_API_KEY:
            print("owner-only: LLM_API_KEY is empty, refusing the live run", file=sys.stderr)
            return 2
    else:
        client = ReplayClient(sorted(args.fixtures.glob("part_learn*.json")))

    default = DEFAULT_PRICES
    prices = Prices(
        default.input_usd_per_million if args.price_input is None else args.price_input,
        default.output_usd_per_million if args.price_output is None else args.price_output,
    )
    report = evaluate(topics, client, prices=prices)
    print(format_report(report))
    if args.json_out is not None:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(to_json(report), indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
