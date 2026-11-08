"""Bayesian Knowledge Tracing: pure functions, no I/O.

Equations (docs/plan.md section 8.2):
  correct:   p' = p(1-s) / [p(1-s) + (1-p)g]
  incorrect: p' = ps / [ps + (1-p)(1-g)]
  learn:     p_next = p' + (1-p') * p_learn
"""

from dataclasses import dataclass

P_MIN = 0.001
P_MAX = 0.999

P_INIT = 0.2
P_LEARN = 0.2
P_SLIP = 0.1
P_GUESS_MCQ = 0.25
P_GUESS_CLOZE = 0.10


@dataclass(frozen=True)
class BktParams:
    p_slip: float = P_SLIP
    p_guess: float = P_GUESS_MCQ
    p_learn: float = P_LEARN
    p_init: float = P_INIT


def clamp(p: float) -> float:
    return min(P_MAX, max(P_MIN, p))


def validate_params(p_slip: float, p_guess: float) -> None:
    """Raise ValueError unless 0 < s < 0.5, 0 < g < 0.5 and g < 1 - s (guarantees P2)."""
    if not 0 < p_slip < 0.5:
        raise ValueError("p_slip must be in (0, 0.5)")
    if not 0 < p_guess < 0.5:
        raise ValueError("p_guess must be in (0, 0.5)")
    if not p_guess < 1 - p_slip:
        raise ValueError("p_guess must be below 1 - p_slip")


def posterior(p: float, correct: bool, p_slip: float, p_guess: float) -> float:
    """P(known | observation), before the learn step."""
    validate_params(p_slip, p_guess)
    p = clamp(p)
    if correct:
        num = p * (1 - p_slip)
        den = num + (1 - p) * p_guess
    else:
        num = p * p_slip
        den = num + (1 - p) * (1 - p_guess)
    return clamp(num / den)


def learn_step(p_post: float, p_learn: float) -> float:
    if not 0 <= p_learn <= 1:
        raise ValueError("p_learn must be in [0, 1]")
    return clamp(p_post + (1 - p_post) * p_learn)


def update(
    p: float, correct: bool, p_slip: float, p_guess: float, p_learn: float
) -> tuple[float, float]:
    """Return (posterior, p_next) for one observation."""
    post = posterior(p, correct, p_slip, p_guess)
    return post, learn_step(post, p_learn)
