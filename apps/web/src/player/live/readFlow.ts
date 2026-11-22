export type ReadStage = "opening" | "reading" | "closing" | "done";

type CheckStep = { state: "predicting" | "hinting" | "revealed" | "skipped" };

export function startStage(checks: readonly CheckStep[], completed: boolean): ReadStage {
  if (completed) return "done";
  return checks[0]?.state === "revealed" ? "reading" : "opening";
}

export const advance = (checks: readonly CheckStep[], completed: boolean): ReadStage => startStage(checks, completed);

export const offersNext = (checks: readonly CheckStep[], completed: boolean) => advance(checks, completed) === "done";

export function hasChecks(kind: string, checks: readonly unknown[]): boolean {
  return (kind === "learn" || kind === "watch") && checks.length >= 2;
}
