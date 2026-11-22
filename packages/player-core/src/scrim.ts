import { seek } from "./seek.ts";
import { editTimeline, scrimFile } from "./scrim-timeline.ts";
import type { SeekResult } from "./types.ts";

const GAP_SHARE = 0.85;
const RUN_DELAY = 0.4;
const END_GATE_LEAD = 0.05;
const PART_GATE_PREFIX = "part-";
const CLOCK_TOLERANCE = 1e-9;

export type TimedEdit = { id: string; segment: number; at: number; cueHeard: boolean; cue: string; predict: string | null; code: string; run?: boolean };

export type ScrimClock = { offsets: number[]; durations: number[]; total: number };

export type ScrimGate = { key: string; t: number; question: string };

export type ScrimRun = { edit: number; t: number };

export type ScrimTimeline = { edits: TimedEdit[]; times: number[]; typing: number[]; gates: ScrimGate[]; runs: ScrimRun[]; clock: ScrimClock; file: string };

export function scrimClock(durations: readonly number[]): ScrimClock {
  const offsets: number[] = [];
  let total = 0;
  for (const d of durations) {
    offsets.push(total);
    total += d;
  }
  return { offsets, durations: [...durations], total };
}

export function editGateKey(id: string): string {
  return `edit:${id}`;
}

function clampTime(t: number, max: number): number {
  return Number.isNaN(t) ? 0 : Math.max(0, Math.min(t, max));
}

export function segmentAt(clock: ScrimClock, t: number): { index: number; local: number } {
  const time = clampTime(t, clock.total);
  let index = 0;
  clock.offsets.forEach((start, i) => {
    if (start <= time) index = i;
  });
  const start = clock.offsets[index] ?? 0;
  return { index, local: Math.min(time - start, clock.durations[index] ?? 0) };
}

function validate(edits: readonly TimedEdit[], clock: ScrimClock): void {
  for (const d of clock.durations) {
    if (!Number.isFinite(d) || d < 0) throw new RangeError(`scrim part duration must be a finite, non-negative number, got ${d}`);
  }
  if (clock.offsets.length !== clock.durations.length || !Number.isFinite(clock.total)) {
    throw new RangeError(`scrim clock must have one finite offset per part and a finite total, got ${clock.offsets.length} offsets and total ${clock.total}`);
  }
  let elapsed = 0;
  clock.offsets.forEach((offset, i) => {
    if (!Number.isFinite(offset) || Math.abs(offset - elapsed) > CLOCK_TOLERANCE) {
      throw new RangeError(`scrim part offset ${i} must equal the sum of the earlier part durations (${elapsed}), got ${offset}`);
    }
    elapsed += clock.durations[i];
  });
  if (Math.abs(clock.total - elapsed) > CLOCK_TOLERANCE) {
    throw new RangeError(`scrim clock total must equal the sum of the part durations (${elapsed}), got ${clock.total}`);
  }
  const gateIds = new Set<string>();
  for (const e of edits) {
    if (!Number.isInteger(e.segment) || e.segment < 0 || e.segment >= clock.durations.length) {
      throw new RangeError(`scrim edit "${e.id}" names part ${e.segment}, but the scrim has ${clock.durations.length} parts`);
    }
    if (!Number.isFinite(e.at)) throw new RangeError(`scrim edit "${e.id}" has a non-finite time ${e.at}`);
    if (e.predict?.trim()) {
      if (gateIds.has(e.id)) throw new RangeError(`scrim gated edit id "${e.id}" is used twice, so its gate key would collide`);
      gateIds.add(e.id);
    }
  }
}

export function buildScrimTimeline(edits: readonly TimedEdit[], predicts: readonly (string | null)[], clock: ScrimClock, language?: string): ScrimTimeline {
  validate(edits, clock);
  const file = scrimFile(language);
  const ordered = edits.map((e) => ({ ...e, predict: e.predict?.trim() ? e.predict : null })).sort((a, b) => a.segment - b.segment || a.at - b.at);
  const times = ordered.map((e) => clock.offsets[e.segment] + clampTime(e.at, clock.durations[e.segment]));
  const typing = ordered.map((e, i) => {
    const before = i > 0 ? ordered[i - 1].code : "";
    const ms = editTimeline(before, e.code, file).duration;
    const next = times[i + 1];
    const gap = next === undefined ? Infinity : (next - times[i]) * GAP_SHARE;
    return Math.max(0, Math.min(ms / 1000, gap, clock.total - times[i]));
  });
  const gates: ScrimGate[] = [
    ...ordered.flatMap((e, i) => (e.predict ? [{ key: editGateKey(e.id), t: times[i], question: e.predict }] : [])),
    ...predicts.flatMap((q, s) =>
      q?.trim() && s < clock.durations.length ? [{ key: `${PART_GATE_PREFIX}${s}`, t:Math.max(clock.offsets[s], clock.offsets[s] + clock.durations[s] - END_GATE_LEAD), question: q }] : [],
    ),
  ].sort((a, b) => a.t - b.t);
  const runs = ordered.flatMap((e, i) => (e.run ? [{ edit: i, t: Math.min(times[i] + typing[i] + RUN_DELAY, clock.total) }] : []));
  return { edits: ordered, times, typing, gates, runs, clock, file };
}

export function openGate(scrim: ScrimTimeline, answered: ReadonlySet<string>): ScrimGate | null {
  return scrim.gates.find((g) => !answered.has(g.key)) ?? null;
}

export function reachable(scrim: ScrimTimeline, answered: ReadonlySet<string>, t: number): number {
  const gate = openGate(scrim, answered);
  return clampTime(t, gate ? gate.t : scrim.clock.total);
}

function partGateBlocks(scrim: ScrimTimeline, answered: ReadonlySet<string>, time: number): boolean {
  return scrim.gates.some((g) => g.key.startsWith(PART_GATE_PREFIX) && g.t <= time && !answered.has(g.key));
}

export function shownEdits(scrim: ScrimTimeline, answered: ReadonlySet<string>, t: number): number {
  let shown = 0;
  while (shown < scrim.times.length && scrim.times[shown] <= t) {
    const edit = scrim.edits[shown];
    if (edit.predict !== null && !answered.has(editGateKey(edit.id))) break;
    if (partGateBlocks(scrim, answered, scrim.times[shown])) break;
    shown++;
  }
  return shown;
}

export function frameAt(scrim: ScrimTimeline, answered: ReadonlySet<string>, t: number): SeekResult {
  const shown = shownEdits(scrim, answered, t);
  if (shown === 0) return { files: { [scrim.file]: "" }, activePath: scrim.file, eventIndex: 0, replayed: 0, lastEdit: null };
  const i = shown - 1;
  const after = scrim.edits[i].code;
  const elapsed = t - scrim.times[i];
  if (elapsed >= scrim.typing[i]) return { files: { [scrim.file]: after }, activePath: scrim.file, eventIndex: shown, replayed: 0, lastEdit: null };
  const before = i > 0 ? scrim.edits[i - 1].code : "";
  const timeline = editTimeline(before, after, scrim.file);
  const progress = scrim.typing[i] > 0 ? elapsed / scrim.typing[i] : 1;
  const result = seek(timeline, Math.max(0, progress) * timeline.duration);
  return { ...result, activePath: scrim.file, files: { [scrim.file]: result.files[scrim.file] ?? after } };
}

export function codeAt(scrim: ScrimTimeline, answered: ReadonlySet<string>, t: number): string {
  return frameAt(scrim, answered, t).files[scrim.file] ?? "";
}

export function runCrossed(scrim: ScrimTimeline, answered: ReadonlySet<string>, from: number, to: number): ScrimRun[] {
  return scrim.runs.filter((r) => from < r.t && r.t <= to && shownEdits(scrim, answered, r.t) > r.edit);
}

export function runsReleased(scrim: ScrimTimeline, before: ReadonlySet<string>, after: ReadonlySet<string>, t: number): ScrimRun[] {
  return scrim.runs.filter((r) => r.t <= t && shownEdits(scrim, before, r.t) <= r.edit && shownEdits(scrim, after, r.t) > r.edit);
}
