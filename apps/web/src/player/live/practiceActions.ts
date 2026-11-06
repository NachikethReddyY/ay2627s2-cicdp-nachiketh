import type { startPython } from "../runPython";

type StartArgs = Parameters<typeof startPython>;

export type PracticeActions = {
  run: { via: "shell" } | { via: "oneshot"; args: StartArgs };
  check: { via: "oneshot"; args: StartArgs };
};

// Run goes through the learner's shell when the sandbox is on; Check is always the one-shot, server-judged run.
export function practiceActions(o: { language: "python" | "javascript"; code: string; lessonId: string; sandboxEnabled: boolean }): PracticeActions {
  return {
    run: o.sandboxEnabled ? { via: "shell" } : { via: "oneshot", args: [o.code, o.language] },
    check: { via: "oneshot", args: [o.code, o.language, o.lessonId] },
  };
}

// Run falls back to the one-shot path when the shell cannot be reached at all (sandbox off, or the socket is
// failing, e.g. a proxy that drops WebSocket upgrades). A plain cold start keeps the "press Run again" note.
export function shouldFallBack(kind: "starting" | "disabled" | "unavailable" | "copy", state: { kind: string }): boolean {
  if (kind === "disabled") return true;
  if (kind !== "starting" && kind !== "unavailable") return false;
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
