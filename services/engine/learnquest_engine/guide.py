from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from .llm import Result, generate

PROMPT = Path(__file__).resolve().parents[3] / "INSTRUCTIONS.md"


class HintWidget(BaseModel):
    type: Literal["hint"]
    title: str = Field(max_length=80)
    body: str = Field(max_length=350)


class StepsWidget(BaseModel):
    type: Literal["steps"]
    title: str = Field(max_length=80)
    items: list[str] = Field(min_length=1, max_length=4)


class QuestionWidget(BaseModel):
    type: Literal["question"]
    text: str = Field(max_length=250)


GuideWidget = Annotated[HintWidget | StepsWidget | QuestionWidget, Field(discriminator="type")]


class GuideReply(BaseModel):
    message: str = Field(min_length=1, max_length=1200)
    widgets: list[GuideWidget] = Field(max_length=3)


def _system() -> str:
    # Read on each request so local persona edits take effect without restarting
    # the long-running development engine.
    return PROMPT.read_text("utf-8")


def reply(data: object) -> Result[GuideReply]:
    return generate(_system(), data, GuideReply, max_tokens=1600)
