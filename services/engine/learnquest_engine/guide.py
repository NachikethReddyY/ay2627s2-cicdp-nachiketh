import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .llm import GenerationError, Result, generate

PROMPT = Path(__file__).resolve().parents[3] / "INSTRUCTIONS.md"
CODE_MARKERS = re.compile(r"```|~~~|=>")
HTML_TAG = re.compile(r"<\s*(?:/\s*)?[a-zA-Z]")
CODE_START = re.compile(
    r"(?:const|let|var|function|class|import|export|def|print|return)\b"
)
CALL_START = re.compile(r"[\w.]+\s*\(")


def _contains_code(text: str) -> bool:
    if CODE_MARKERS.search(text) or HTML_TAG.search(text):
        return True
    for raw in text.splitlines():
        line = raw.strip()
        if CODE_START.match(line) and any(marker in line for marker in "=({;:"):
            return True
        if line.rstrip(";").rstrip().endswith(")") and CALL_START.match(line):
            return True
    return False


class LintFinding(BaseModel):
    """One static-analysis note about a single line of learner code. Sent as data only."""

    model_config = ConfigDict(extra="forbid")

    ruleId: str = Field(max_length=80)
    message: str = Field(max_length=300)
    line: int = Field(ge=1)
    sourceLine: str = Field(max_length=200)


class HintWidget(BaseModel):
    type: Literal["hint"]
    title: str = Field(max_length=80)
    body: str = Field(max_length=350)


class StepsWidget(BaseModel):
    type: Literal["steps"]
    title: str = Field(max_length=80)
    items: list[Annotated[str, Field(max_length=350)]] = Field(min_length=1, max_length=4)


class QuestionWidget(BaseModel):
    type: Literal["question"]
    text: str = Field(max_length=250)


GuideWidget = Annotated[HintWidget | StepsWidget | QuestionWidget, Field(discriminator="type")]


class GuideReply(BaseModel):
    message: str = Field(min_length=1, max_length=1200)
    widgets: list[GuideWidget] = Field(max_length=3)

    @model_validator(mode="after")
    def coaching_only(self) -> "GuideReply":
        texts = [self.message]
        for widget in self.widgets:
            if isinstance(widget, HintWidget):
                texts.extend([widget.title, widget.body])
            elif isinstance(widget, StepsWidget):
                texts.extend([widget.title, *widget.items])
            else:
                texts.append(widget.text)
        for text in texts:
            if _contains_code(text):
                raise ValueError(
                    "Give a brief conceptual clue or prediction question. "
                    "Remove code, markup and solution instructions from every field."
                )
        return self


@lru_cache(maxsize=1)
def _system() -> str:
    return PROMPT.read_text("utf-8")


def reply(data: object) -> Result[GuideReply]:
    try:
        return generate(_system(), data, GuideReply, max_tokens=1600)
    except GenerationError:
        return Result(
            GuideReply(
                message="What do you expect your code to do next? Let's reason through one step.",
                widgets=[],
            ),
            {"prompt_tokens": 0, "completion_tokens": 0, "model": ""},
            2,
        )
