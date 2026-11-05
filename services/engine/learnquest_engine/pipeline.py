import json
from functools import cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from learnquest_engine import visual
from learnquest_engine.llm import GenerationError, Result, generate
from learnquest_engine.schemas import PARTS, Lesson, LessonContext, Outline

PROMPTS = Path(__file__).parent / "prompts"


@cache
def _prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def outline(topic: str) -> Result[Outline]:
    return generate(_prompt("outline"), {"topic": topic}, Outline)


def lesson(ctx: LessonContext) -> Result[BaseModel]:
    kind = ctx.lesson.kind
    if kind == "predict":
        return generate(_prompt("lesson"), ctx.model_dump(), Lesson)
    system = _prompt(kind.replace("-", "_"))
    if kind not in ("learn", "game-practice"):
        return generate(system, ctx.model_dump(), PARTS[kind])
    ctx_data = ctx.model_dump()
    res = generate(system + "\n\n" + visual._system(embedded=True), ctx_data, PARTS[kind])
    if kind == "game-practice":
        return _checked_game(system, ctx_data, res)
    # Model output is untrusted: keep the doc only if it passes the committed schema.
    doc = getattr(res.value, "doc", None)
    if doc is not None:
        res.value = res.value.model_copy(update={"doc": visual.validated(doc)})
    return res


def _game_issues(part: BaseModel) -> tuple[dict[str, Any] | None, list[str]]:
    """Flatten the part's doc and run the full check (schema + the web's parseSpec)."""
    raw = getattr(part, "doc", None)
    if raw is None:
        return None, [
            "doc: missing; a game-practice part needs a visual document with a game block"
        ]
    doc = visual.unwrap(raw)
    # CheckerUnavailable propagates: fail closed, as /visual does.
    return doc, visual.all_issues(doc)


def _checked_game(
    system: str, ctx_data: dict[str, Any], res: Result[BaseModel]
) -> Result[BaseModel]:
    """Fail an unsolvable game here, not later in the API gate (that forces a full regeneration)."""
    doc, found = _game_issues(res.value)
    if found:
        # One repair call with the exact problems, then give up with a 422.
        payload = {**ctx_data, "fix_these_issues": found, "previous_part": res.value.model_dump()}
        fixed = generate(
            system + "\n\n" + visual._system(embedded=True), payload, PARTS["game-practice"]
        )
        res = Result(
            fixed.value,
            {
                "prompt_tokens": res.usage["prompt_tokens"] + fixed.usage["prompt_tokens"],
                "completion_tokens": res.usage["completion_tokens"]
                + fixed.usage["completion_tokens"],
                "model": res.usage["model"],
            },
            res.attempts + fixed.attempts,
        )
        doc, found = _game_issues(res.value)
        if found:
            raise GenerationError(json.dumps(found)[:2048])
    return Result(res.value.model_copy(update={"doc": doc}), res.usage, res.attempts)
