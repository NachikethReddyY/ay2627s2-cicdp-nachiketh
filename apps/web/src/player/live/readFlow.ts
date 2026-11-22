export type ReadStage = "opening" | "reading" | "closing" | "done";

type CheckStep = { state: "predicting" | "hinting" | "revealed" | "skipped" };

const answered = (s: CheckStep | undefined) => s?.state === "revealed" || s?.state === "skipped";

export function startStage(checks: readonly CheckStep[]): ReadStage {
  if (answered(checks[checks.length - 1])) return "done";
  return answered(checks[0]) ? "reading" : "opening";
}

export function hasChecks(kind: string, checks: readonly unknown[]): boolean {
  return (kind === "learn" || kind === "watch") && checks.length >= 2;
}
