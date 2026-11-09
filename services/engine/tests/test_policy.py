from hypothesis import given, settings
from hypothesis import strategies as st

from learnquest_engine.policy import (
    Action,
    Lesson,
    Mastery,
    ReasonCode,
    Recommendation,
    recommend,
)

L1 = Lesson("l1", ["vars"], "learn", False, 1)
L2 = Lesson("l2", ["vars"], "predict", False, 2)
L3 = Lesson("l3", ["loops"], "learn", False, 3)
L4 = Lesson("l4", ["loops"], "game-practice", False, 4)


def test_start_when_no_observations() -> None:
    r = recommend([], [], [L1, L2])
    assert (r.action, r.lesson_id, r.reason_code) == (Action.START, "l1", ReasonCode.START)
    assert "vars" in r.reason


def test_learn_below_boundary_prefers_learn_lesson() -> None:
    r = recommend([Mastery("vars", 0.2)], [], [L2, L1])
    assert (r.action, r.lesson_id, r.concept_id) == (Action.LEARN, "l1", "vars")
    assert "20%" in r.reason


def test_practice_prefers_practice_kind() -> None:
    r = recommend([Mastery("vars", 0.6)], [], [L1, L2])
    assert (r.action, r.lesson_id) == (Action.PRACTICE, "l2")
    assert "60%" in r.reason


def test_boundary_040_is_practice() -> None:
    assert recommend([Mastery("vars", 0.4)], [], [L1, L2]).action == Action.PRACTICE


def test_advance_when_all_mastered() -> None:
    r = recommend([Mastery("vars", 0.97)], [], [Lesson("l1", ["vars"], "learn", True, 1), L3])
    assert (r.action, r.lesson_id, r.reason_code) == (Action.ADVANCE, "l3", ReasonCode.ADVANCE)
    assert "vars" in r.reason


def test_locked_unmastered_concept_blocks_advance() -> None:
    # vars mastered, loops below mastered but locked behind an unmet prerequisite.
    m = [Mastery("vars", 0.97), Mastery("loops", 0.5)]
    edges = [("prep", "loops")]
    r = recommend(m, edges, [L1, L3])
    assert r.action != Action.ADVANCE
    assert (r.action, r.concept_id, r.reason_code) == (
        Action.PRACTICE,
        "loops",
        ReasonCode.PRACTICE,
    )
    assert "prerequisites" in r.reason
    assert "mastered" not in r.reason


def test_advance_reason_lists_only_mastered_and_uses_titles() -> None:
    done = Lesson("l1", ["vars"], "learn", True, 1, "Variables")
    nxt = Lesson("l3", ["loops"], "learn", False, 3, "Loops")
    r = recommend([Mastery("vars", 0.97)], [], [done, nxt])
    assert r.reason == "You've mastered vars. Next up: Loops."


def test_start_reason_uses_titles() -> None:
    r = recommend(
        [], [], [Lesson("l1", ["vars"], "learn", False, 1, "Variables")], world_title="JS"
    )
    assert r.reason == "You haven't started JS yet. Start with Variables, which introduces vars."


def test_done_when_nothing_remains() -> None:
    r = recommend([Mastery("vars", 0.97)], [], [Lesson("l1", ["vars"], "learn", True, 1)])
    assert (r.action, r.lesson_id, r.concept_id) == (Action.DONE, None, None)


def test_tie_goes_to_course_order() -> None:
    m = [Mastery("loops", 0.5), Mastery("vars", 0.5)]
    r = recommend(m, [], [L1, L2, L3, L4])
    assert r.concept_id == "vars"


def test_lowest_mastery_wins() -> None:
    m = [Mastery("vars", 0.7), Mastery("loops", 0.3)]
    assert recommend(m, [], [L1, L2, L3, L4]).concept_id == "loops"


def test_locked_prerequisites_are_skipped() -> None:
    m = [Mastery("vars", 0.6), Mastery("loops", 0.1)]
    r = recommend(m, [("vars", "loops")], [L1, L2, L3, L4])
    assert r.concept_id == "vars"


def test_unlocked_once_prerequisite_reaches_threshold() -> None:
    m = [Mastery("vars", 0.8), Mastery("loops", 0.1)]
    assert recommend(m, [("vars", "loops")], [L1, L3]).concept_id == "loops"


def test_falls_back_to_any_covering_lesson() -> None:
    only = Lesson("l9", ["vars"], "game-practice", False, 1)
    assert recommend([Mastery("vars", 0.1)], [], [only]).lesson_id == "l9"


def test_unfinished_concept_with_no_remaining_lesson_is_not_practised() -> None:
    # "vars" is below mastery, but its only lesson is done.
    # The open lesson teaches "loops" and must be chosen.
    vars_done = Lesson("l1", ["vars"], "learn", True, 1)
    loops = Lesson("l3", ["loops"], "learn", False, 2)
    rec = recommend([Mastery("vars", 0.1), Mastery("loops", 0.9)], [], [vars_done, loops])
    assert rec.concept_id != "vars"
    assert rec.lesson_id == "l3"


concept_ids = st.sampled_from(["a", "b", "c", "d"])
kinds = st.sampled_from(["learn", "watch", "practice", "game-practice", "predict"])
lessons_st = st.lists(
    st.builds(
        Lesson,
        lesson_id=st.uuids().map(str),
        concept_ids=st.lists(concept_ids, min_size=1, max_size=3, unique=True),
        kind=kinds,
        done=st.booleans(),
        order=st.integers(0, 100),
    ),
    max_size=8,
)
mastery_st = st.lists(
    st.builds(Mastery, concept_id=concept_ids, p_known=st.floats(0.001, 0.999)),
    max_size=4,
    unique_by=lambda m: m.concept_id,
)
edges_st = st.lists(st.tuples(concept_ids, concept_ids), max_size=5)


@settings(deadline=None)
@given(mastery=mastery_st, edges=edges_st, lessons=lessons_st)
def test_every_recommendation_has_a_reason(
    mastery: list[Mastery], edges: list[tuple[str, str]], lessons: list[Lesson]
) -> None:
    r: Recommendation = recommend(mastery, edges, lessons)
    assert r.reason.strip()
    assert r.reason_code in set(ReasonCode)
    assert (r.lesson_id is None) == (r.action == Action.DONE)


def test_start_without_titles_reads_naturally() -> None:
    r = recommend([], [], [L1])
    assert r.reason == (
        "You haven't started this world yet. Start with the next lesson, which introduces vars."
    )
    assert "l1" not in r.reason
    assert "yet yet" not in r.reason


def test_advance_without_title_does_not_leak_the_lesson_id() -> None:
    r = recommend([Mastery("vars", 0.99)], [], [L3])
    assert r.action == Action.ADVANCE
    assert r.reason == "You've mastered vars. Next up: the next lesson."
    assert "l3" not in r.reason


def test_reason_default_world_has_no_double_yet() -> None:
    from learnquest_engine.policy import _reason

    assert "yet yet" not in _reason(ReasonCode.START, ["vars"], lesson="X")
