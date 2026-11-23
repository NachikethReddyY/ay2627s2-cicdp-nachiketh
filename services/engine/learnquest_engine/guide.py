import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationInfo,
    model_validator,
)

from .llm import Result, generate

PROMPT = Path(__file__).resolve().parents[3] / "INSTRUCTIONS.md"
CODE_MARKERS = re.compile(r"```|~~~|=>")
HTML_TAG = re.compile(r"<\s*(?:/\s*)?[a-zA-Z]")
CODE_START = re.compile(
    r"(?:const|let|var|function|class|import|export|def|print|return)\b"
)
CALL_START = re.compile(r"[\w.]+\s*\(")
INLINE_CODE = re.compile(r"`([^`\n]+)`")
IDENTIFIER = re.compile(r"[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*")
NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _contains_code(text: str) -> bool:
    if CODE_MARKERS.search(text) or HTML_TAG.search(text):
        return True
    if any(not IDENTIFIER.fullmatch(span) for span in INLINE_CODE.findall(text)):
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
    title: NonBlank = Field(max_length=80)
    body: NonBlank = Field(max_length=350)


class StepsWidget(BaseModel):
    type: Literal["steps"]
    title: NonBlank = Field(max_length=80)
    items: list[Annotated[NonBlank, Field(max_length=350)]] = Field(min_length=1, max_length=4)


class QuestionWidget(BaseModel):
    type: Literal["question"]
    text: NonBlank = Field(max_length=250)


GuideWidget = Annotated[HintWidget | StepsWidget | QuestionWidget, Field(discriminator="type")]


class GuideUserMessage(BaseModel):
    role: Literal["user"]
    content: str = Field(min_length=1, max_length=2000)


class GuideAssistantMessage(BaseModel):
    role: Literal["assistant"]
    content: str = Field(min_length=1, max_length=2000)
    widgets: list[GuideWidget] = Field(default_factory=list, max_length=3)


GuideMessage = Annotated[
    GuideUserMessage | GuideAssistantMessage, Field(discriminator="role")
]


def _coaching_text(message: str, widgets: list[GuideWidget]) -> list[str]:
    texts = [message]
    for widget in widgets:
        if isinstance(widget, HintWidget):
            texts.append(widget.body)
        elif isinstance(widget, StepsWidget):
            texts.extend(widget.items)
        else:
            texts.append(widget.text)
    return texts


def _normalized(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.casefold()))


class GuideReply(BaseModel):
    message: NonBlank = Field(max_length=1200)
    widgets: list[GuideWidget] = Field(max_length=3)

    @model_validator(mode="after")
    def coaching_only(self, info: ValidationInfo) -> "GuideReply":
        coaching = _coaching_text(self.message, self.widgets)
        texts = [*coaching, *(w.title for w in self.widgets if not isinstance(w, QuestionWidget))]
        for text in texts:
            if _contains_code(text):
                raise ValueError(
                    "Give a brief conceptual clue or prediction question. "
                    "Remove code, markup and solution instructions from every field."
                )
        previous: set[str] = info.context["previous_coaching"] if info.context else set()
        current = [_normalized(text) for text in coaching]
        if previous.intersection(current) or len(current) != len(set(current)):
            raise ValueError("Give a different clue or question. Avoid repeating earlier coaching.")
        return self


@lru_cache(maxsize=1)
def _system() -> str:
    return PROMPT.read_text("utf-8")


def reply(data: object, messages: list[GuideMessage]) -> Result[GuideReply]:
    previous = {
        _normalized(text)
        for message in messages
        if isinstance(message, GuideAssistantMessage)
        for text in _coaching_text(message.content, message.widgets)
    }
    return generate(
        _system(), data, GuideReply, max_tokens=1600, context={"previous_coaching": previous}
    )
