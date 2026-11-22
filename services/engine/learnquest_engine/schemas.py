"""Pydantic ports of the zod models in apps/api/src/ai/service.ts, plus the leak check."""

from collections.abc import Sequence
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, ValidationInfo, model_validator


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


class OutlineLesson(BaseModel):
    title: T80
    level: int = Field(ge=1, le=5)
    concepts: list[T60] = Field(min_length=1, max_length=6)
    kind: Literal["predict", "learn", "watch", "practice", "game-practice", "scrim"]


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


_Loose200 = Annotated[str, StringConstraints(max_length=200)]


class _Path(BaseModel):
    title: str = Field(max_length=200)
    tagline: str = Field(max_length=400)


class _Course(BaseModel):
    title: str = Field(max_length=200)
    description: str = Field(max_length=1000)


class _LessonRef(BaseModel):
    title: str = Field(max_length=200)
    level: int = Field(ge=1, le=5)
    concepts: list[_Loose200] = Field(max_length=12)
    kind: Literal["predict", "learn", "watch", "practice", "game-practice", "scrim"] = "predict"


T4000 = Annotated[str, _c(4000)]


class LearnPart(BaseModel):
    kind: Literal["learn"]
    body: T4000
    doc: dict[str, Any] | None = None


class WatchPart(BaseModel):
    kind: Literal["watch"]
    beforeFiles: dict[T200, Annotated[str, StringConstraints(max_length=6000)]]
    hunks: list[Hunk] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def _files(self) -> "WatchPart":
        if not 1 <= len(self.beforeFiles) <= 4:
            raise ValueError("beforeFiles needs 1 to 4 files")
        return self


PRACTICE_TEST_ID = r"^[a-z0-9][a-z0-9-]{0,31}$"
PRACTICE_REQUIRED = (3, 5)
PRACTICE_SAMPLE_MIN = 1
PRACTICE_SAMPLE_MAX = 2
PRACTICE_STRETCH_MAX = 10
PRACTICE_TOTAL_MAX = 25


class PracticeTest(BaseModel):
    """One deterministic check: the engine runs the learner's program with `stdin`."""

    id: Annotated[str, StringConstraints(pattern=PRACTICE_TEST_ID)]
    name: T80
    stdin: Annotated[str, StringConstraints(max_length=1000)] = ""
    expectedStdout: Annotated[str, StringConstraints(max_length=1000)]
    visibility: Literal["sample", "hidden"]
    stretch: bool = False


class PracticePart(BaseModel):
    """`tests` holds the required tests plus the stretch tests the request asked for.

    The expected stretch count comes from validation context (`stretchTests`, default 0),
    so the same model serves every request and the repair flow reports count errors.
    """

    kind: Literal["practice"]
    instructions: T1000
    language: Literal["python", "javascript", "typescript"]
    starterCode: Annotated[str, StringConstraints(max_length=3000)]
    tests: list[PracticeTest] = Field(min_length=1, max_length=PRACTICE_TOTAL_MAX)

    @model_validator(mode="before")
    @classmethod
    def _no_legacy_output(cls, data: Any) -> Any:
        if isinstance(data, dict) and "expectedOutput" in data:
            raise ValueError("expectedOutput is no longer supported: write a tests list instead")
        return data

    @model_validator(mode="after")
    def _tests(self, info: ValidationInfo) -> "PracticePart":
        wanted = int((info.context or {}).get("stretchTests", 0))
        required = [t for t in self.tests if not t.stretch]
        stretch = [t for t in self.tests if t.stretch]
        ids = [t.id for t in self.tests]
        if len(set(ids)) != len(ids):
            raise ValueError("test ids must be unique within the part")
        low, high = PRACTICE_REQUIRED
        if not low <= len(required) <= high:
            raise ValueError(f"needs {low} to {high} required tests, got {len(required)}")
        if len(stretch) != wanted:
            raise ValueError(f"needs exactly {wanted} stretch tests, got {len(stretch)}")
        if any(t.visibility != "hidden" for t in stretch):
            raise ValueError("stretch tests must have visibility hidden")
        samples = [t for t in required if t.visibility == "sample"]
        if not PRACTICE_SAMPLE_MIN <= len(samples) <= PRACTICE_SAMPLE_MAX:
            raise ValueError(
                f"needs {PRACTICE_SAMPLE_MIN} to {PRACTICE_SAMPLE_MAX} required tests "
                f"with visibility sample, got {len(samples)}"
            )
        return self


class GamePracticePart(BaseModel):
    kind: Literal["game-practice"]
    intro: T500
    doc: dict[str, Any] | None = None


SCRIM_SEGMENTS = (4, 8)
SCRIM_MAX_GATES = 3
SCRIM_MS_PER_WORD = 420
SCRIM_MIN_SEGMENT_MS = 3000
SCRIM_MAX_SEGMENT_MS = 40000
SCRIM_LEAK_MIN_CHARS = 3
SCRIM_ADDED_LINE_MIN_CHARS = 4


def segment_duration_ms(text: str) -> int:
    """Narration length by word count; the model never writes timings."""
    words = len(text.split())
    return min(SCRIM_MAX_SEGMENT_MS, max(SCRIM_MIN_SEGMENT_MS, words * SCRIM_MS_PER_WORD))


class ScrimEdit(BaseModel):
    code: Annotated[str, StringConstraints(min_length=1, max_length=3000)]
    run: bool


class ScrimSegmentDraft(BaseModel):
    text: T500
    edit: ScrimEdit | None = None
    gate: int | None = Field(default=None, ge=0, le=SCRIM_MAX_GATES - 1)


class ScrimSegment(ScrimSegmentDraft):
    durationMs: int = Field(ge=SCRIM_MIN_SEGMENT_MS, le=SCRIM_MAX_SEGMENT_MS)


def _added_lines(step: McqStep) -> list[str]:
    lines = [line[1:].strip() for h in step.hunks for line in h.lines if line.startswith("+")]
    return [line for line in lines if len(line) >= SCRIM_ADDED_LINE_MIN_CHARS]


def _check_scrim(
    language: str,
    segments: Sequence[ScrimSegmentDraft],
    steps: Sequence[McqStep],
    lab: PracticePart,
) -> None:
    if lab.language != language:
        raise ValueError("the lab language must equal the scrim language")
    if segments[0].edit is None:
        raise ValueError("segment 0 must show code")
    if segments[-1].gate is not None:
        raise ValueError("the last segment cannot be a gate: nothing would reveal the answer")
    gates = [s.gate for s in segments if s.gate is not None]
    if gates != list(range(len(steps))):
        raise ValueError("every step must be the gate of exactly one segment, in step order")
    code = ""
    for i, segment in enumerate(segments):
        if segment.edit is not None:
            code = segment.edit.code
        if segment.gate is None:
            continue
        step = steps[segment.gate]
        answer = _norm(step.options[step.answer])
        spoken = [_norm(s.text) for s in segments[: i + 1]]
        if len(answer) >= SCRIM_LEAK_MIN_CHARS and any(answer in text for text in spoken):
            raise ValueError(f"step {step.title!r}: narration up to the gate leaks the answer")
        added = _added_lines(step)
        if any(line in code for line in added):
            raise ValueError(f"step {step.title!r}: the code at the gate already shows the change")


class ScrimDraft(BaseModel):
    """What the model writes. `steps` are the mcq gates the segments point at by index."""

    kind: Literal["scrim"]
    language: Literal["python", "javascript", "typescript"]
    segments: list[ScrimSegmentDraft] = Field(
        min_length=SCRIM_SEGMENTS[0], max_length=SCRIM_SEGMENTS[1]
    )
    steps: list[McqStep] = Field(min_length=1, max_length=SCRIM_MAX_GATES)
    lab: PracticePart

    @model_validator(mode="after")
    def _check(self) -> "ScrimDraft":
        _check_scrim(self.language, self.segments, self.steps, self.lab)
        return self


class ScrimPart(BaseModel):
    """The draft with a duration on every segment, as the API stores it."""

    kind: Literal["scrim"]
    language: Literal["python", "javascript", "typescript"]
    segments: list[ScrimSegment] = Field(min_length=SCRIM_SEGMENTS[0], max_length=SCRIM_SEGMENTS[1])
    steps: list[McqStep] = Field(min_length=1, max_length=SCRIM_MAX_GATES)
    lab: PracticePart

    @model_validator(mode="after")
    def _check(self) -> "ScrimPart":
        _check_scrim(self.language, self.segments, self.steps, self.lab)
        return self


def timed(draft: ScrimDraft, stretch_tests: int) -> ScrimPart:
    data = draft.model_dump()
    for segment in data["segments"]:
        segment["durationMs"] = segment_duration_ms(segment["text"])
    return ScrimPart.model_validate(data, context={"stretchTests": stretch_tests})


PARTS: dict[str, type[BaseModel]] = {
    "learn": LearnPart,
    "watch": WatchPart,
    "practice": PracticePart,
    "game-practice": GamePracticePart,
    "scrim": ScrimDraft,
}


class LessonContext(BaseModel):
    path: _Path
    course: _Course
    lesson: _LessonRef
    missedConcepts: list[_Loose200] = Field(max_length=50)
    stretchTests: int = Field(default=0, ge=0, le=PRACTICE_STRETCH_MAX)


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
