import type { checkPractice, startPython } from "../runPython.ts";
import type { PracticeLanguage } from "./checkModel.ts";

type StartArgs = Parameters<typeof startPython>;

export type PracticeActions = {
  run: { via: "shell" } | { via: "oneshot"; args: StartArgs };
  check: { via: "check"; args: Parameters<typeof checkPractice> };
};

export const SHELL_LANGUAGES: readonly PracticeLanguage[] = ["python", "javascript"];

export function practiceActions(o: { language: PracticeLanguage; code: string; lessonId: string; sandboxEnabled: boolean; authored?: boolean }): PracticeActions {
  const shell = o.sandboxEnabled && !o.authored && SHELL_LANGUAGES.includes(o.language);
  return {
    run: shell ? { via: "shell" } : { via: "oneshot", args: [o.code, o.language] },
    check: { via: "check", args: [{ code: o.code, language: o.language, lessonId: o.lessonId }] },
  };
}

export function shouldFallBack(kind: "starting" | "disabled" | "unavailable" | "copy", state: { kind: string }, timeouts = 0): boolean {
  if (kind === "disabled") return true;
  if (kind !== "starting" && kind !== "unavailable") return false;
  if (kind === "starting" && state.kind === "connecting" && timeouts >= 2) return true;
  return state.kind === "reconnecting" || state.kind === "closed";
}

export function skipShellWait(unreachable: boolean, state: { kind: string; reason?: string; ready?: boolean }): boolean {
  if (state.kind === "open" && state.ready) return false;
  if (state.kind === "reconnecting") return true;
  if (state.kind === "closed") return state.reason !== "replaced";
  return unreachable && state.kind !== "exited";
}
