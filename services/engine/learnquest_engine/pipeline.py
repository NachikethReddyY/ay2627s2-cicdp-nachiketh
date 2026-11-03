from functools import cache
from pathlib import Path

from pydantic import BaseModel

from learnquest_engine import visual
from learnquest_engine.llm import Result, generate
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
    res = generate(system + "\n\n" + visual._system(), ctx.model_dump(), PARTS[kind])
    # Model output is untrusted: keep the doc only if it passes the committed schema.
    doc = getattr(res.value, "doc", None)
    if doc is not None:
        res.value = res.value.model_copy(update={"doc": visual.validated(doc)})
    return res
