export type ReadStage = "opening" | "reading" | "closing" | "done";

type CheckStep = { state: "predicting" | "hinting" | "revealed" | "skipped" };

export function startStage(checks: readonly CheckStep[], completed: boolean): ReadStage {
  if (completed) return "done";
  return checks[0]?.state === "revealed" ? "reading" : "opening";
}

export const advance = (stage: ReadStage): ReadStage => (stage === "opening" ? "reading" : stage === "closing" ? "done" : stage);

export const offersNext = (stage: ReadStage) => stage === "done";

export function hasChecks(kind: string, checks: readonly unknown[]): boolean {
  return (kind === "learn" || kind === "watch") && checks.length >= 2;
}
