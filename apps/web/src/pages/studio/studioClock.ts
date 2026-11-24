import { seek } from "@learnquest/player-core";
import { editTimeline, STUDIO_FILE } from "./studioTimeline.ts";
import type { TimedEdit } from "./studioModel.ts";

const GAP_SHARE = 0.85;
const RUN_DELAY = 0.4;
const END_GATE_LEAD = 0.05;

export type Clock = { offsets: number[]; durations: number[]; total: number };

export type Gate = { key: string; t: number; question: string };

export type Lesson = { edits: TimedEdit[]; times: number[]; typing: number[]; gates: Gate[]; runs: { edit: number; t: number }[]; clock: Clock };

export function lessonClock(durations: readonly number[]): Clock {
  const offsets: number[] = [];
  let total = 0;
  for (const d of durations) {
    offsets.push(total);
    total += d;
  }
  return { offsets, durations: [...durations], total };
}

export function segmentAt(clock: Clock, t: number): { index: number; local: number } {
  let index = 0;
  clock.offsets.forEach((start, i) => {
    if (start <= t) index = i;
  });
  return { index, local: Math.max(0, t - (clock.offsets[index] ?? 0)) };
}

export function buildLesson(edits: readonly TimedEdit[], predicts: readonly (string | null)[], clock: Clock): Lesson {
  const ordered = [...edits].sort((a, b) => a.segment - b.segment || a.at - b.at);
  const times = ordered.map((e) => (clock.offsets[e.segment] ?? 0) + Math.min(e.at, clock.durations[e.segment] ?? e.at));
  const typing = ordered.map((e, i) => {
    const before = i > 0 ? ordered[i - 1].code : "";
    const ms = editTimeline(before, e.code).duration;
    const next = times[i + 1];
    const gap = next === undefined ? Infinity : (next - times[i]) * GAP_SHARE;
    return Math.min(ms / 1000, gap);
  });
  const gates: Gate[] = [
    ...ordered.flatMap((e, i) => (e.predict ? [{ key: `edit-${i}`, t: times[i], question: e.predict }] : [])),
    ...predicts.flatMap((q, s) =>
      q && s < clock.durations.length ? [{ key: `part-${s}`, t: (clock.offsets[s] ?? 0) + (clock.durations[s] ?? 0) - END_GATE_LEAD, question: q }] : [],
    ),
  ].sort((a, b) => a.t - b.t);
  const runs = ordered.flatMap((e, i) => (e.run ? [{ edit: i, t: times[i] + typing[i] + RUN_DELAY }] : []));
  return { edits: ordered, times, typing, gates, runs, clock };
}

export function openGate(lesson: Lesson, answered: ReadonlySet<string>): Gate | null {
  return lesson.gates.find((g) => !answered.has(g.key)) ?? null;
}

export function reachable(lesson: Lesson, answered: ReadonlySet<string>, t: number): number {
  const gate = openGate(lesson, answered);
  return Math.max(0, Math.min(t, gate ? gate.t : lesson.clock.total));
}

export function shownEdits(lesson: Lesson, answered: ReadonlySet<string>, t: number): number {
  let shown = 0;
  lesson.times.forEach((at, i) => {
    const locked = lesson.edits[i].predict !== null && !answered.has(`edit-${i}`);
    if (at <= t && !locked && shown === i) shown = i + 1;
  });
  return shown;
}

export function codeAt(lesson: Lesson, answered: ReadonlySet<string>, t: number): string {
  const shown = shownEdits(lesson, answered, t);
  if (shown === 0) return "";
  const i = shown - 1;
  const after = lesson.edits[i].code;
  const elapsed = t - lesson.times[i];
  if (elapsed >= lesson.typing[i]) return after;
  const before = i > 0 ? lesson.edits[i - 1].code : "";
  const timeline = editTimeline(before, after);
  const progress = lesson.typing[i] > 0 ? elapsed / lesson.typing[i] : 1;
  return seek(timeline, Math.max(0, progress) * timeline.duration).files[STUDIO_FILE] ?? after;
}

export function runCrossed(lesson: Lesson, from: number, to: number): { edit: number; t: number } | null {
  return lesson.runs.find((r) => from < r.t && r.t <= to) ?? null;
}
