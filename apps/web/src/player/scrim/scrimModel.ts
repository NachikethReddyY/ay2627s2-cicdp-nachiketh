import {
  buildScrimTimeline,
  codeAt,
  openGate,
  reachable,
  scrimClock,
  type ScrimGate,
  type ScrimTimeline,
  type TimedEdit,
} from "@learnquest/player-core";
import type { Lesson, Part } from "../live/types.ts";

type ScrimPart = Extract<Part, { kind: "scrim" }>;
type Segment = ScrimPart["segments"][number];

export function planScrim(segments: readonly Segment[]): { edits: TimedEdit[]; stepByKey: Record<string, string> } {
  const edits: TimedEdit[] = [];
  const stepByKey: Record<string, string> = {};
  let previous = "";
  segments.forEach((segment, index) => {
    if (!segment.edit && !segment.gate) return;
    const code = segment.edit?.code ?? previous;
    if (segment.gate) stepByKey[`edit-${edits.length}`] = segment.gate;
    edits.push({ segment: index, at: 0, cueHeard: true, cue: "", predict: segment.gate ?? null, code, run: segment.edit?.run });
    previous = code;
  });
  return { edits, stepByKey };
}

export function scrimTimeline(segments: readonly Segment[]): ScrimTimeline {
  return buildScrimTimeline(planScrim(segments).edits, [], scrimClock(segments.map((s) => s.durationMs / 1000)));
}

export function narrationBySegment(media: Lesson["media"], count: number): (string | null)[] {
  return Array.from({ length: count }, (_, s) => media.find((m) => m.kind === "narration" && m.segment === s)?.url ?? null);
}

const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_FRAME = (CHANNELS * BITS_PER_SAMPLE) / 8;
const HEADER_BYTES = 44;

export function silentWav(seconds: number): Uint8Array<ArrayBuffer> {
  const dataBytes = Math.round(SAMPLE_RATE * seconds) * BYTES_PER_FRAME;
  const bytes = new Uint8Array(new ArrayBuffer(HEADER_BYTES + dataBytes));
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  ascii(0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_FRAME, true);
  view.setUint16(32, BYTES_PER_FRAME, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return bytes;
}

export type Playback = { scrim: ScrimTimeline; t: number; playing: boolean; answered: ReadonlySet<string> };

export type PlaybackAction =
  | { type: "play" }
  | { type: "pause" }
  | { type: "tick"; t: number }
  | { type: "seek"; t: number }
  | { type: "answer"; key: string };

export function initPlayback(scrim: ScrimTimeline, answered: Iterable<string>): Playback {
  return { scrim, t: 0, playing: false, answered: new Set(answered) };
}

export function heldGate(state: Playback): ScrimGate | null {
  const gate = openGate(state.scrim, state.answered);
  return gate && state.t >= gate.t ? gate : null;
}

export function finished(state: Playback): boolean {
  return state.t >= state.scrim.clock.total && heldGate(state) === null;
}

export function codeShown(state: Playback): string {
  return codeAt(state.scrim, state.answered, state.t);
}

function moveTo(state: Playback, t: number): Playback {
  const next = { ...state, t: reachable(state.scrim, state.answered, t) };
  const stopped = heldGate(next) !== null || next.t >= next.scrim.clock.total;
  return stopped ? { ...next, playing: false } : next;
}

export function playbackReducer(state: Playback, action: PlaybackAction): Playback {
  switch (action.type) {
    case "tick":
    case "seek":
      return moveTo(state, action.t);
    case "pause":
      return { ...state, playing: false };
    case "play":
      if (heldGate(state)) return state;
      if (state.t >= state.scrim.clock.total) return { ...state, t: 0, playing: true };
      return { ...state, playing: true };
    case "answer": {
      const gate = openGate(state.scrim, state.answered);
      if (!gate || gate.key !== action.key) return state;
      return { ...state, answered: new Set([...state.answered, action.key]), playing: true };
    }
  }
}
