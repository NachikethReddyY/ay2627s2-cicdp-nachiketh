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
