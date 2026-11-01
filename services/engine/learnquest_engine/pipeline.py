from functools import cache
from pathlib import Path

from pydantic import BaseModel

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
    return generate(_prompt(kind), ctx.model_dump(), PARTS[kind])
