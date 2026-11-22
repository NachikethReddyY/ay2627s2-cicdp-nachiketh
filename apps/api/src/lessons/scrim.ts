import { TRPCError } from "@trpc/server";
import type { Scrim } from "../parts/scrim-schema.ts";

export type ScrimGateState = { id: string; state: "predicting" | "hinting" | "revealed" };

export const malformedScrim = () => new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scrim lesson is malformed" });

export const scrimStepState = (state: string | null): ScrimGateState["state"] =>
  state === "revealed" || state === "hinting" ? state : "predicting";

export function scrimGateStates(scrim: Scrim, rows: ReadonlyArray<{ id: string; idx: number; pub: { kind: string }; state: string | null }>) {
  const gates = new Map<number, ScrimGateState>();
  for (const segment of scrim.segments) {
    if (segment.gate === undefined) continue;
    const step = rows.find((row) => row.idx === segment.gate);
    if (!step || step.pub.kind !== "mcq") throw malformedScrim();
    gates.set(segment.gate, { id: step.id, state: scrimStepState(step.state) });
  }
  if (gates.size !== rows.length) throw malformedScrim();
  return gates;
}

function pendingSegment(scrim: Scrim, gates: ReadonlyMap<number, ScrimGateState>) {
  return scrim.segments.findIndex((segment) => segment.gate !== undefined && gates.get(segment.gate)?.state !== "revealed");
}

export function scrimGateOpen(scrim: Scrim, gates: ReadonlyMap<number, ScrimGateState>, stepIdx: number) {
  const segment = scrim.segments.findIndex((candidate) => candidate.gate === stepIdx);
  const pending = pendingSegment(scrim, gates);
  return segment >= 0 && (pending < 0 || segment <= pending);
}

export const servedGateIds = (segments: ReadonlyArray<{ gate?: string }>) => segments.flatMap((segment) => (segment.gate ? [segment.gate] : []));

export function publicScrimMedia<T extends { stepId: string | null; segment: number | null }>(
  media: readonly T[],
  served: { from: number; to: number; revealedStepIds: ReadonlySet<string> },
) {
  return media.filter(
    (item) =>
      (item.stepId !== null || item.segment !== null) &&
      (item.stepId === null || served.revealedStepIds.has(item.stepId)) &&
      (item.segment === null || (item.segment >= served.from && item.segment < served.to)),
  );
}

export function publicScrimSegments(scrim: Scrim, gates: ReadonlyMap<number, ScrimGateState>, from = 0) {
  const pending = pendingSegment(scrim, gates);
  const end = pending < 0 ? scrim.segments.length : pending + 1;
  const start = Math.min(from, end);
  const segments = scrim.segments.slice(start, end).map((segment) => {
    const gate = segment.gate === undefined ? undefined : gates.get(segment.gate);
    return {
      text: segment.text,
      durationMs: segment.durationMs,
      ...(segment.edit && (gate === undefined || gate.state === "revealed") && { edit: { code: segment.edit.code, run: segment.edit.run } }),
      ...(gate && { gate: gate.id }),
    };
  });
  return { segments, nextOffset: end, complete: end === scrim.segments.length };
}
