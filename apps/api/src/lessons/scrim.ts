import type { Scrim } from "../parts/scrim-schema.ts";

export type ScrimGateState = { id: string; state: "predicting" | "hinting" | "revealed" | "skipped" };

export function publicScrimSegments(scrim: Scrim, gates: ReadonlyMap<number, ScrimGateState>, from = 0) {
  const pending = scrim.segments.findIndex((segment) => {
    if (segment.gate === undefined) return false;
    const state = gates.get(segment.gate)?.state;
    return state !== "revealed" && state !== "skipped";
  });
  const end = pending < 0 ? scrim.segments.length : pending + 1;
  const start = Math.min(from, end);
  const segments = scrim.segments.slice(start, end).map((segment) => {
    const gate = segment.gate === undefined ? undefined : gates.get(segment.gate);
    const unlocked = gate?.state === "revealed" || gate?.state === "skipped";
    return {
      text: segment.text,
      durationMs: segment.durationMs,
      ...(segment.edit && (segment.gate === undefined || unlocked) && { edit: { code: segment.edit.code, run: segment.edit.run } }),
      ...(gate && { gate: gate.id }),
    };
  });
  return { segments, nextOffset: end, complete: end === scrim.segments.length };
}
