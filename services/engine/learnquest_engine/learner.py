"""Request and response models for the learner-model routes (no LLM involved).

Field names are camelCase to match the other engine request models and the API client.
"""

from typing import Literal

from pydantic import BaseModel, Field

from learnquest_engine import bkt, policy


class Prior(BaseModel):
    conceptId: str = Field(min_length=1, max_length=200)
    pKnown: float | None = Field(default=None, ge=0, le=1)


class BktParamsIn(BaseModel):
    pSlip: float | None = None
    pGuess: float | None = None
    pLearn: float | None = Field(default=None, ge=0, le=1)
    pInit: float | None = Field(default=None, ge=0, le=1)


class MasteryUpdateRequest(BaseModel):
    priors: list[Prior] = Field(max_length=50)
    params: BktParamsIn = Field(default_factory=BktParamsIn)
    questionType: Literal["mcq", "cloze"]
    correct: bool


class MasteryUpdate(BaseModel):
    conceptId: str
    pPosterior: float
    pNext: float


class MasteryUpdateResponse(BaseModel):
    updates: list[MasteryUpdate]


def update_mastery(req: MasteryUpdateRequest) -> MasteryUpdateResponse:
    """Raises ValueError on invalid BKT parameters (the route maps it to 422)."""
    p = req.params
    p_guess = (
        p.pGuess
        if p.pGuess is not None
        else bkt.P_GUESS_MCQ
        if req.questionType == "mcq"
        else bkt.P_GUESS_CLOZE
    )
    p_slip = p.pSlip if p.pSlip is not None else bkt.P_SLIP
    p_learn = p.pLearn if p.pLearn is not None else bkt.P_LEARN
    p_init = p.pInit if p.pInit is not None else bkt.P_INIT
    bkt.validate_params(p_slip, p_guess)
    updates = []
    for prior in req.priors:
        start = prior.pKnown if prior.pKnown is not None else p_init
        post, nxt = bkt.update(start, req.correct, p_slip, p_guess, p_learn)
        updates.append(MasteryUpdate(conceptId=prior.conceptId, pPosterior=post, pNext=nxt))
    return MasteryUpdateResponse(updates=updates)


class MasteryIn(BaseModel):
    conceptId: str = Field(min_length=1, max_length=200)
    pKnown: float = Field(ge=0, le=1)


class LessonIn(BaseModel):
    lessonId: str = Field(min_length=1, max_length=200)
    conceptIds: list[str] = Field(max_length=50)
    kind: str = Field(min_length=1, max_length=40)
    done: bool
    order: int


class NextRequest(BaseModel):
    mastery: list[MasteryIn] = Field(max_length=500)
    edges: list[tuple[str, str]] = Field(default_factory=list, max_length=2000)
    lessons: list[LessonIn] = Field(max_length=500)
    unlockAt: float = Field(default=0.8, ge=0, le=1)
    masteredAt: float = Field(default=0.95, ge=0, le=1)


class NextResponse(BaseModel):
    action: policy.Action
    lessonId: str | None
    conceptId: str | None
    reasonCode: policy.ReasonCode
    reason: str


def next_step(req: NextRequest) -> NextResponse:
    rec = policy.recommend(
        [policy.Mastery(m.conceptId, m.pKnown) for m in req.mastery],
        req.edges,
        [policy.Lesson(x.lessonId, x.conceptIds, x.kind, x.done, x.order) for x in req.lessons],
        unlock_at=req.unlockAt,
        mastered_at=req.masteredAt,
    )
    return NextResponse(
        action=rec.action,
        lessonId=rec.lesson_id,
        conceptId=rec.concept_id,
        reasonCode=rec.reason_code,
        reason=rec.reason,
    )
