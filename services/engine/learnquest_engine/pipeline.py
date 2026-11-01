from functools import cache
from pathlib import Path

from learnquest_engine.llm import Result, generate
from learnquest_engine.schemas import Lesson, LessonContext, Outline

PROMPTS = Path(__file__).parent / "prompts"


@cache
def _prompt(name: str) -> str:
    return (PROMPTS / f"{name}.md").read_text(encoding="utf-8")


def outline(topic: str) -> Result[Outline]:
    return generate(_prompt("outline"), {"topic": topic}, Outline)


def lesson(ctx: LessonContext) -> Result[Lesson]:
    return generate(_prompt("lesson"), ctx.model_dump(), Lesson)
