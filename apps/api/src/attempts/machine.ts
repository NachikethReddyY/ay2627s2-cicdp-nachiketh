type State = "predicting" | "hinting" | "revealed" | "skipped";
export type Progress = { state: State; rungsTaken: number; attemptAllowed: boolean; retryAllowed: boolean };
export type Action = { type: "attempt"; correct: boolean } | { type: "hint" } | { type: "skip" };
export type Outcome = { type: "attempt"; correct: boolean } | { type: "hint"; rung: number } | { type: "skip" };

export const fresh = (): Progress => ({ state: "predicting", rungsTaken: 0, attemptAllowed: true, retryAllowed: false });

// Pure: grading happens before this, persistence after. Table in docs/api-plan.md T6.
export function next(
  p: Progress,
  a: Action,
  step: { hintCount: number },
): { progress: Progress; outcome: Outcome } | { conflict: string } {
  if (p.state === "revealed" || p.state === "skipped") return { conflict: "Step is already finished" };

  if (a.type === "skip") return { progress: { ...p, state: "skipped" }, outcome: { type: "skip" } };

  if (a.type === "hint") {
    if (p.rungsTaken >= step.hintCount) return { conflict: "No hints left" };
    const rung = p.rungsTaken + 1;
    return {
      progress: { ...p, rungsTaken: rung, state: "hinting", attemptAllowed: true },
      outcome: { type: "hint", rung },
    };
  }

  if (p.state === "hinting" && !p.attemptAllowed) return { conflict: "Take the next hint first" };
  const outcome: Outcome = { type: "attempt", correct: a.correct };
  if (a.correct) return { progress: { ...p, state: "revealed" }, outcome };
  // With no hints to take, a wrong first answer goes straight to the retry (otherwise only skip would be left).
  if (p.state === "predicting" && step.hintCount === 0) {
    return { progress: { ...p, state: "hinting", attemptAllowed: true, retryAllowed: true }, outcome };
  }
  if (p.state === "predicting") return { progress: { ...p, state: "hinting", attemptAllowed: false }, outcome };
  if (p.retryAllowed) return { progress: { ...p, state: "revealed", retryAllowed: false }, outcome };
  if (p.rungsTaken >= step.hintCount) {
    return { progress: { ...p, attemptAllowed: true, retryAllowed: true }, outcome };
  }
  return { progress: { ...p, attemptAllowed: false }, outcome };
}
