"""Pydantic ports of the zod models in apps/api/src/ai/service.ts, plus the leak check."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator


def _c(n: int) -> StringConstraints:
    return StringConstraints(strip_whitespace=True, min_length=1, max_length=n)


T40 = Annotated[str, _c(40)]
T60 = Annotated[str, _c(60)]
T80 = Annotated[str, _c(80)]
T100 = Annotated[str, _c(100)]
T160 = Annotated[str, _c(160)]
T200 = Annotated[str, _c(200)]
T300 = Annotated[str, _c(300)]
T400 = Annotated[str, _c(400)]
T500 = Annotated[str, _c(500)]
T1000 = Annotated[str, _c(1000)]


class OutlineLesson(BaseModel):  # outline lesson
    title: T80
    level: int = Field(ge=1, le=5)
    concepts: list[T60] = Field(min_length=1, max_length=6)
    kind: Literal["learn", "watch", "practice"]


class Course(BaseModel):
    title: T80
    description: T300
    lessons: list[OutlineLesson] = Field(min_length=3, max_length=6)


class Outline(BaseModel):
    """Either `refused: true` alone, or title + tagline + courses.

    One flat model instead of a root union: strict json_schema needs an object at the root.
    """

    refused: Literal[True] | None = None
    title: T80 | None = None
    tagline: T160 | None = None
    courses: list[Course] | None = Field(default=None, min_length=2, max_length=4)

    @model_validator(mode="after")
    def _one_shape(self) -> "Outline":
        full = self.title is not None and self.tagline is not None and self.courses is not None
        if self.refused:
            if self.title or self.tagline or self.courses:
                raise ValueError("refused outline must omit everything else")
        elif not full:
            raise ValueError("outline needs title, tagline and courses")
        return self


class Hunk(BaseModel):
    id: T40
    file: T200
    oldStart: int = Field(ge=1)
    lines: list[Annotated[str, StringConstraints(max_length=300)]] = Field(
        min_length=1, max_length=60
    )


class Hint(BaseModel):
    text: T400
    eliminate: int | None = Field(default=None, ge=0, le=3)


class Explanations(BaseModel):
    workedExample: T1000
    practice: T500


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


class _Step(BaseModel):
    title: T100
    prompt: T500
    beforeFiles: dict[T200, Annotated[str, StringConstraints(max_length=6000)]]
    hunks: list[Hunk] = Field(min_length=1, max_length=6)
    hints: list[Hint] = Field(min_length=1, max_length=2)
    explanations: Explanations
    concepts: list[T60] = Field(default=[], max_length=6)

    def _answers(self) -> list[str]:
        raise NotImplementedError

    @model_validator(mode="after")
    def _check(self) -> "_Step":
        if not 1 <= len(self.beforeFiles) <= 4:
            raise ValueError("beforeFiles needs 1 to 4 files")
        haystack = [_norm(h.text) for h in self.hints]
        haystack += [_norm(self.title), _norm(self.explanations.workedExample)]
        for a in map(_norm, self._answers()):
            if len(a) >= 3 and any(a in h for h in haystack):
                raise ValueError(
                    f"step {self.title!r}: hints, title or workedExample leak the answer"
                )
        return self


class McqStep(_Step):
    kind: Literal["mcq"]
    options: list[T200] = Field(min_length=4, max_length=4)
    answer: int = Field(ge=0, le=3)

    def _answers(self) -> list[str]:
        return [self.options[self.answer]]

    @model_validator(mode="after")
    def _eliminate(self) -> "McqStep":
        if any(h.eliminate == self.answer for h in self.hints):
            raise ValueError(f"step {self.title!r}: bad eliminate")
        return self


class ClozeStep(_Step):
    kind: Literal["cloze"]
    answer: T100
    accepted: list[T100] = Field(default=[], max_length=6)

    def _answers(self) -> list[str]:
        return [self.answer, *self.accepted]


Step = Annotated[McqStep | ClozeStep, Field(discriminator="kind")]


class Lesson(BaseModel):
    steps: list[Step] = Field(min_length=3, max_length=5)


class _Path(BaseModel):
    title: str
    tagline: str


class _Course(BaseModel):
    title: str
    description: str


class _LessonRef(BaseModel):
    title: str
    level: int
    concepts: list[str]
    kind: Literal["predict", "learn", "watch", "practice", "game-practice"] = "predict"


T4000 = Annotated[str, _c(4000)]


# One flat model per part kind: strict json_schema needs an object at the root.
class LearnPart(BaseModel):
    kind: Literal["learn"]
    body: T4000
    doc: dict[str, Any] | None = None  # dropped by the pipeline if invalid


class WatchPart(BaseModel):
    kind: Literal["watch"]
    beforeFiles: dict[T200, Annotated[str, StringConstraints(max_length=6000)]]
    hunks: list[Hunk] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def _files(self) -> "WatchPart":
        if not 1 <= len(self.beforeFiles) <= 4:
            raise ValueError("beforeFiles needs 1 to 4 files")
        return self


class PracticePart(BaseModel):
    kind: Literal["practice"]
    instructions: T1000
    language: Literal["python", "javascript"]
    starterCode: Annotated[str, StringConstraints(max_length=3000)]
    expectedOutput: Annotated[str, StringConstraints(max_length=1000)]


class GamePracticePart(BaseModel):
    kind: Literal["game-practice"]
    intro: T500
    doc: dict[str, Any] | None = None


PARTS: dict[str, type[BaseModel]] = {
    "learn": LearnPart,
    "watch": WatchPart,
    "practice": PracticePart,
    "game-practice": GamePracticePart,
}


class LessonContext(BaseModel):
    path: _Path
    course: _Course
    lesson: _LessonRef
    missedConcepts: list[str]


def json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """JSON schema for response_format. Strict mode needs additionalProperties: false everywhere.

    shortcut: strict mode also wants every property in `required` and no oneOf; servers that
    reject it fall back to json_object (llm.py), upgrade if a provider needs the full rewrite.
    """

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            node = {("anyOf" if k == "oneOf" else k): walk(v) for k, v in node.items()}
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
        elif isinstance(node, list):
            node = [walk(v) for v in node]
        return node

    schema: dict[str, Any] = walk(model.model_json_schema())
    return schema
