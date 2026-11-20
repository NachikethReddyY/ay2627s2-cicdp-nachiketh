import { seek } from "./seek.ts";
import { editTimeline, SCRIM_FILE } from "./scrim-timeline.ts";

const GAP_SHARE = 0.85;
const RUN_DELAY = 0.4;
const END_GATE_LEAD = 0.05;

export type TimedEdit = { segment: number; at: number; cueHeard: boolean; cue: string; predict: string | null; code: string; run?: boolean };

export type ScrimClock = { offsets: number[]; durations: number[]; total: number };

export type ScrimGate = { key: string; t: number; question: string };

export type ScrimTimeline = { edits: TimedEdit[]; times: number[]; typing: number[]; gates: ScrimGate[]; runs: { edit: number; t: number }[]; clock: ScrimClock };

export function scrimClock(durations: readonly number[]): ScrimClock {
  const offsets: number[] = [];
  let total = 0;
  for (const d of durations) {
    offsets.push(total);
    total += d;
  }
  return { offsets, durations: [...durations], total };
}

export function segmentAt(clock: ScrimClock, t: number): { index: number; local: number } {
  let index = 0;
  clock.offsets.forEach((start, i) => {
    if (start <= t) index = i;
  });
  return { index, local: Math.max(0, t - (clock.offsets[index] ?? 0)) };
}

export function buildScrimTimeline(edits: readonly TimedEdit[], predicts: readonly (string | null)[], clock: ScrimClock): ScrimTimeline {
  const ordered = edits.map((e) => ({ ...e, predict: e.predict?.trim() ? e.predict : null })).sort((a, b) => a.segment - b.segment || a.at - b.at);
  const times = ordered.map((e) => Math.max(0, Math.min(clock.total, (clock.offsets[e.segment] ?? 0) + Math.min(e.at, clock.durations[e.segment] ?? e.at))));
  const typing = ordered.map((e, i) => {
    const before = i > 0 ? ordered[i - 1].code : "";
    const ms = editTimeline(before, e.code).duration;
    const next = times[i + 1];
    const gap = next === undefined ? Infinity : (next - times[i]) * GAP_SHARE;
    return Math.max(0, Math.min(ms / 1000, gap, clock.total - times[i]));
  });
  const gates: ScrimGate[] = [
    ...ordered.flatMap((e, i) => (e.predict ? [{ key: `edit-${i}`, t: times[i], question: e.predict }] : [])),
    ...predicts.flatMap((q, s) =>
      q && s < clock.durations.length ? [{ key: `part-${s}`, t: (clock.offsets[s] ?? 0) + (clock.durations[s] ?? 0) - END_GATE_LEAD, question: q }] : [],
    ),
  ].sort((a, b) => a.t - b.t);
  const runs = ordered.flatMap((e, i) => (e.run ? [{ edit: i, t: Math.min(times[i] + typing[i] + RUN_DELAY, clock.total) }] : []));
  return { edits: ordered, times, typing, gates, runs, clock };
}

export function openGate(scrim: ScrimTimeline, answered: ReadonlySet<string>): ScrimGate | null {
  return scrim.gates.find((g) => !answered.has(g.key)) ?? null;
}

export function reachable(scrim: ScrimTimeline, answered: ReadonlySet<string>, t: number): number {
  const gate = openGate(scrim, answered);
  return Math.max(0, Math.min(t, gate ? gate.t : scrim.clock.total));
}

export function shownEdits(scrim: ScrimTimeline, answered: ReadonlySet<string>, t: number): number {
  let shown = 0;
  scrim.times.forEach((at, i) => {
    const locked = scrim.edits[i].predict !== null && !answered.has(`edit-${i}`);
    if (at <= t && !locked && shown === i) shown = i + 1;
  });
  return shown;
}

export function codeAt(scrim: ScrimTimeline, answered: ReadonlySet<string>, t: number): string {
  const shown = shownEdits(scrim, answered, t);
  if (shown === 0) return "";
  const i = shown - 1;
  const after = scrim.edits[i].code;
  const elapsed = t - scrim.times[i];
  if (elapsed >= scrim.typing[i]) return after;
  const before = i > 0 ? scrim.edits[i - 1].code : "";
  const timeline = editTimeline(before, after);
  const progress = scrim.typing[i] > 0 ? elapsed / scrim.typing[i] : 1;
  return seek(timeline, Math.max(0, progress) * timeline.duration).files[SCRIM_FILE] ?? after;
}

export function runCrossed(scrim: ScrimTimeline, from: number, to: number): { edit: number; t: number } | null {
  return scrim.runs.find((r) => from < r.t && r.t <= to) ?? null;
}
