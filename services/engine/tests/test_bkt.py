import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from learnquest_engine.bkt import (
    P_GUESS_MCQ,
    P_LEARN,
    P_SLIP,
    clamp,
    learn_step,
    posterior,
    update,
    validate_params,
)

probs = st.floats(min_value=0, max_value=1)
slips = st.floats(min_value=0.001, max_value=0.499)
guesses = st.floats(min_value=0.001, max_value=0.499)
learns = st.floats(min_value=0, max_value=1)


def valid(s: float, g: float) -> bool:
    try:
        validate_params(s, g)
    except ValueError:
        return False
    return True


@settings(deadline=None)
@given(p=probs, s=slips, g=guesses, learn=learns, correct=st.booleans())
def test_p1_outputs_are_probabilities(
    p: float, s: float, g: float, learn: float, correct: bool
) -> None:
    assume(valid(s, g))
    post, nxt = update(p, correct, s, g, learn)
    assert 0 <= post <= 1
    assert 0 <= nxt <= 1


@settings(deadline=None)
@given(p=probs, s=slips, g=guesses)
def test_p2_observation_direction(p: float, s: float, g: float) -> None:
    assume(valid(s, g))
    assert posterior(p, True, s, g) >= clamp(p) - 1e-12
    assert posterior(p, False, s, g) <= clamp(p) + 1e-12


@settings(deadline=None)
@given(p=probs, s=slips, g=guesses, learn=learns, correct=st.booleans())
def test_learn_step_never_lowers(p: float, s: float, g: float, learn: float, correct: bool) -> None:
    assume(valid(s, g))
    post, nxt = update(p, correct, s, g, learn)
    assert nxt >= post - 1e-12


def test_p3_wrong_answer_can_raise_p_next() -> None:
    post, nxt = update(0.2, False, P_SLIP, P_GUESS_MCQ, P_LEARN)
    assert post < 0.2
    assert nxt == pytest.approx(0.226, abs=0.001)
    assert nxt > 0.2


def test_p3_three_correct_answers_converge() -> None:
    p = 0.2
    seen = []
    for _ in range(3):
        _, p = update(p, True, P_SLIP, P_GUESS_MCQ, P_LEARN)
        seen.append(p)
    assert seen == pytest.approx([0.579, 0.866, 0.967], abs=0.01)
    assert p >= 0.95


@pytest.mark.parametrize(
    ("s", "g"), [(0, 0.2), (0.5, 0.2), (0.1, 0), (0.1, 0.5), (-1, 0.2), (0.1, 1.2)]
)
def test_bad_params_raise(s: float, g: float) -> None:
    with pytest.raises(ValueError):
        validate_params(s, g)


def test_bad_learn_raises() -> None:
    with pytest.raises(ValueError):
        learn_step(0.5, 1.5)


def test_extremes_are_clamped() -> None:
    assert posterior(0, True, 0.1, 0.25) > 0
    assert posterior(1, False, 0.1, 0.25) < 1
