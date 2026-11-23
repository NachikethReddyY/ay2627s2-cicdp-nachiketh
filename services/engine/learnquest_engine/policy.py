"""Next-step policy: pure, no I/O. Picks which lesson comes next and says why.

Rules, first match wins (docs/lq-22-plan.md section 4):
  1. no observations in this world -> start
  2. lowest-mastery unlocked concept in an unfinished lesson below mastered_at -> learn
     (< learn_below) or practice
  3. nothing weak and a lesson remains -> advance, naming only concepts at or above mastered_at
  4. nothing remains -> done

Prioritise available lessons and select the lowest observed mastery first.
A lesson is omitted when the course is finished or prerequisites block progress.
Reasons never contain step content, hints or expected output.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum


class Action(StrEnum):
    START = "start"
    LEARN = "learn"
    PRACTICE = "practice"
    ADVANCE = "advance"
    DONE = "done"


class ReasonCode(StrEnum):
    START = "START"
    LEARN = "LEARN"
    PRACTICE = "PRACTICE"
    ADVANCE = "ADVANCE"
    DONE = "DONE"
    REVIEW = "REVIEW"
    PREREQUISITES = "PREREQUISITES"


@dataclass(frozen=True)
class Mastery:
    concept_id: str
    p_known: float


@dataclass(frozen=True)
class Lesson:
    lesson_id: str
    concept_ids: Sequence[str]
    kind: str
    done: bool
    order: int
    title: str | None = None
    available: bool = True


@dataclass(frozen=True)
class Recommendation:
    action: Action
    lesson_id: str | None
    concept_id: str | None
    reason_code: ReasonCode
    reason: str


POLICY_VERSION = "7"

LEARN_KINDS = ("learn", "watch")
PRACTICE_KINDS = ("predict", "practice", "game-practice")


def _pct(p: float) -> int:
    return round(p * 100)


def _reason(
    code: ReasonCode,
    concepts: Sequence[str] = (),
    p_known: float = 0.0,
    world: str = "this world",
    lesson: str = "",
    locked: bool = False,
) -> str:
    """The only place a learner-facing reason is built."""
    name = concepts[0] if concepts else "a new concept"
    match code:
        case ReasonCode.START:
            return f"You haven't started {world} yet. Start with {lesson}, which introduces {name}."
        case ReasonCode.LEARN:
            return f"{name} is at {_pct(p_known)}%. A worked explanation comes first."
        case ReasonCode.PRACTICE:
            if locked:
                return (
                    f"{name} is at {_pct(p_known)}%, but its prerequisites come first. "
                    "More practice will make them stick."
                )
            return f"{name} is at {_pct(p_known)}%. More practice will make it stick."
        case ReasonCode.ADVANCE:
            if not concepts:
                return f"Next up: {lesson}."
            mastered = " ".join(f"You've mastered {concept}." for concept in concepts[:3])
            return f"{mastered} Next up: {lesson}."
        case ReasonCode.REVIEW:
            return f"{name} is at {_pct(p_known)}%. Review this concept before moving on."
        case ReasonCode.PREREQUISITES:
            return "Build mastery in the prerequisite concepts to unlock the next lesson."
        case ReasonCode.DONE:
            return "You've finished every lesson here. Nothing left to do."


def _label(lesson: Lesson) -> str:
    return lesson.title or "the next lesson"


def _pick(candidates: list[Lesson], preferred_kinds: tuple[str, ...]) -> Lesson | None:
    for lesson in candidates:
        if lesson.kind in preferred_kinds:
            return lesson
    return candidates[0] if candidates else None


def recommend(
    mastery: Sequence[Mastery],
    edges: Sequence[tuple[str, str]],
    lessons: Sequence[Lesson],
    unlock_at: float = 0.8,
    mastered_at: float = 0.95,
    learn_below: float = 0.4,
    world_title: str | None = None,
) -> Recommendation:
    ordered = sorted(lessons, key=lambda lesson: lesson.order)
    remaining = [lesson for lesson in ordered if not lesson.done]
    known = {m.concept_id: m.p_known for m in mastery}
    if not remaining:
        return Recommendation(Action.DONE, None, None, ReasonCode.DONE, _reason(ReasonCode.DONE))

    remaining = [lesson for lesson in remaining if lesson.available]
    if not remaining:
        code = ReasonCode.PREREQUISITES
        return Recommendation(Action.PRACTICE, None, None, code, _reason(code))

    remaining_concepts = {c for lesson in remaining for c in lesson.concept_ids}

    if not known:
        first = remaining[0]
        return Recommendation(
            Action.START,
            first.lesson_id,
            first.concept_ids[0] if first.concept_ids else None,
            ReasonCode.START,
            _reason(
                ReasonCode.START,
                first.concept_ids,
                world=world_title or "this world",
                lesson=_label(first),
            ),
        )

    prereqs: dict[str, list[str]] = {}
    for src, dst in edges:
        prereqs.setdefault(dst, []).append(src)

    def unlocked(concept: str) -> bool:
        return all(known.get(pre, 0.0) >= unlock_at for pre in prereqs.get(concept, []))

    course_order: dict[str, int] = {}
    for lesson in ordered:
        for concept in lesson.concept_ids:
            course_order.setdefault(concept, len(course_order))
    for concept in known:
        course_order.setdefault(concept, len(course_order))

    open_below = [c for c, p in known.items() if p < mastered_at and c in remaining_concepts]
    candidates = [c for c in open_below if unlocked(c)]
    below = open_below
    locked = not candidates and bool(below)
    pool = candidates or below
    if pool:
        concept = min(pool, key=lambda c: (known[c], course_order[c]))
        p = known[concept]
        covering = [lesson for lesson in remaining if concept in lesson.concept_ids]
        learning = p < learn_below and not locked
        kinds = LEARN_KINDS if learning else PRACTICE_KINDS
        chosen = _pick(covering, kinds) or remaining[0]
        explanation = learning and chosen.kind in LEARN_KINDS
        action = Action.LEARN if explanation else Action.PRACTICE
        code = ReasonCode.LEARN if explanation else (
            ReasonCode.REVIEW if p < learn_below else ReasonCode.PRACTICE
        )
        reason = _reason(code, [concept], p, locked=locked)
        return Recommendation(action, chosen.lesson_id, concept, code, reason)

    mastered = sorted((c for c in known if known[c] >= mastered_at), key=lambda c: course_order[c])
    open_lessons = [lesson for lesson in remaining if all(unlocked(c) for c in lesson.concept_ids)]
    chosen = (open_lessons or remaining)[0]
    return Recommendation(
        Action.ADVANCE,
        chosen.lesson_id,
        chosen.concept_ids[0] if chosen.concept_ids else None,
        ReasonCode.ADVANCE,
        _reason(ReasonCode.ADVANCE, mastered, lesson=_label(chosen)),
    )
