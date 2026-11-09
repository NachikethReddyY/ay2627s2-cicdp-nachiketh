import type { checkPractice, startPython } from "../runPython.ts";
import type { PracticeLanguage } from "./checkModel.ts";

type StartArgs = Parameters<typeof startPython>;

export type PracticeActions = {
  run: { via: "shell" } | { via: "oneshot"; args: StartArgs };
  check: { via: "check"; args: Parameters<typeof checkPractice> };
};

// Run goes through the learner's shell when the sandbox is on; Check is always the server-judged multi-test call.
// The shell Run copies solution.py or solution.js, so TypeScript (no shell target yet) runs one-shot.
export function practiceActions(o: { language: PracticeLanguage; code: string; lessonId: string; sandboxEnabled: boolean }): PracticeActions {
  return {
    run: o.sandboxEnabled && o.language !== "typescript" ? { via: "shell" } : { via: "oneshot", args: [o.code, o.language] },
    check: { via: "check", args: [{ code: o.code, language: o.language, lessonId: o.lessonId }] },
  };
}

// Run falls back to the one-shot path when the shell cannot be reached at all (sandbox off, or the socket is
// failing, e.g. a proxy that drops WebSocket upgrades). A plain cold start keeps the "press Run again" note once;
// a second readiness timeout in a row (`timeouts`, reset when the shell is ready) while still connecting means the
// host is unreachable, so it falls back too.
export function shouldFallBack(kind: "starting" | "disabled" | "unavailable" | "copy", state: { kind: string }, timeouts = 0): boolean {
  if (kind === "disabled") return true;
  if (kind !== "starting" && kind !== "unavailable") return false;
  if (kind === "starting" && state.kind === "connecting" && timeouts >= 2) return true;
  return state.kind === "reconnecting" || state.kind === "closed";
}

// Run skips the shell (and its 15 s ready wait) when it is clearly unreachable: an earlier Run already fell back and
// the shell has not been ready since, or the socket is reconnecting or closed right now. A closed-as-replaced
// terminal and an exited shell keep the normal copy path with its own explanation; connecting and open-but-not-ready
// are a genuine cold start and keep the wait.
export function skipShellWait(unreachable: boolean, state: { kind: string; reason?: string; ready?: boolean }): boolean {
  if (state.kind === "open" && state.ready) return false;
  if (state.kind === "reconnecting") return true;
  if (state.kind === "closed") return state.reason !== "replaced";
  return unreachable && state.kind !== "exited";
}
