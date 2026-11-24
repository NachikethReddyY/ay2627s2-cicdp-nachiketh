import json
from functools import cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from learnquest_engine import visual
from learnquest_engine.llm import GenerationError, Result, generate
from learnquest_engine.schemas import (
    PARTS,
    Lesson,
    LessonContext,
    Outline,
    ScrimDraft,
    StudioEdits,
    StudioPlan,
    StudioScript,
    timed,
)

PROMPTS = Path(__file__).parent / "prompts"


@cache
def _prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def outline(topic: str) -> Result[Outline]:
    return generate(_prompt("outline"), {"topic": topic}, Outline)


def studio_plan(topic: str, source: str) -> Result[StudioPlan]:
    return generate(_prompt("studio_plan"), {"topic": topic, "source": source}, StudioPlan)


def studio_script(plan: StudioPlan) -> Result[StudioScript]:
    return generate(_prompt("studio_script"), {"plan": plan.model_dump()}, StudioScript)


def studio_edits(plan: StudioPlan, segments: list[str]) -> Result[StudioEdits]:
    data = {"plan": plan.model_dump(), "segments": segments}
    return generate(_prompt("studio_edits"), data, StudioEdits, context={"segments": segments})


def lesson(ctx: LessonContext) -> Result[BaseModel]:
    kind = ctx.lesson.kind
    if kind == "predict":
        return generate(_prompt("lesson"), ctx.model_dump(), Lesson)
    system = _prompt(kind.replace("-", "_"))
    if kind in ("practice", "scrim"):
        system += _stretch_note(ctx.stretchTests)
    if kind not in ("learn", "game-practice"):
        res = generate(
            system,
            ctx.model_dump(),
            PARTS[kind],
            context={"stretchTests": ctx.stretchTests},
        )
        if isinstance(res.value, ScrimDraft):
            return Result(timed(res.value, ctx.stretchTests), res.usage, res.attempts)
        return res
    ctx_data = ctx.model_dump()
    res = generate(system + "\n\n" + visual._system(embedded=True), ctx_data, PARTS[kind])
    return _checked_document(system, ctx_data, res, kind)


def _stretch_note(stretch_tests: int) -> str:
    """Per-request instruction; the practice prompt file itself is shared by all requests."""
    if stretch_tests == 0:
        return "\n\nThis request: write no stretch tests. Every test has stretch false."
    return (
        f"\n\nThis request: write exactly {stretch_tests} stretch tests (stretch true, "
        "visibility hidden), in addition to the required tests."
    )


def _document_issues(part: BaseModel, kind: str) -> tuple[dict[str, Any] | None, list[str]]:
    """Flatten the part's doc and run the full check (schema + the web's parseSpec)."""
    raw = getattr(part, "doc", None)
    if raw is None and kind == "learn":
        return None, []
    if raw is None:
        return None, [
            "doc: missing; a game-practice part needs a visual document with a game block"
        ]
    doc = visual.unwrap(raw)
    found = visual.all_issues(doc)
    blocks = doc.get("blocks", [])
    if kind == "game-practice" and not any(
        isinstance(b, dict) and b.get("type") == "game" for b in blocks
    ):
        found.append('blocks: a game-practice doc needs a block with type "game"')
    return doc, found


def _checked_document(
    system: str, ctx_data: dict[str, Any], res: Result[BaseModel], kind: str
) -> Result[BaseModel]:
    """Fail an unsolvable game here, not later in the API gate (that forces a full regeneration)."""
    doc, found = _document_issues(res.value, kind)
    if found:
        payload = {**ctx_data, "fix_these_issues": found, "previous_part": res.value.model_dump()}
        fixed = generate(system + "\n\n" + visual._system(embedded=True), payload, PARTS[kind])
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
        doc, found = _document_issues(res.value, kind)
        if found:
            raise GenerationError(json.dumps(found)[:2048])
    return Result(res.value.model_copy(update={"doc": doc}), res.usage, res.attempts)
