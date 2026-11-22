import test from "node:test";
import assert from "node:assert/strict";
import { initPlayback, narrationBySegment, partSkipTarget, planScrim, playbackReducer, resumeTime, scrimTimeline, silentWav, heldGate, finished, speechCue } from "./scrimModel.ts";
import type { Lesson, Part } from "../live/types.ts";

type Segment = Extract<Part, { kind: "scrim" }>["segments"][number];

const seg = (o: Partial<Segment> = {}): Segment => ({ text: "t", durationMs: 2000, ...o });

test("silentWav has a PCM header and the right length", () => {
  const wav = silentWav(0.5);
  assert.equal(wav.length, 44 + 4000 * 2);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.slice(8, 12)), "WAVE");
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 8000);
  assert.equal(new DataView(wav.buffer).getUint32(40, true), 8000);
});

test("narrationBySegment picks narration urls by segment", () => {
  const media = [
    { kind: "narration", segment: 1, url: "/b" },
    { kind: "image", segment: 0, url: "/x" },
  ] as unknown as Lesson["media"];
  assert.deepEqual(narrationBySegment(media, 3), [null, "/b", null]);
});

test("speech starts at a silent segment, and stops at a pause, a gate or the end", () => {
  const cues = { texts: ["a", "b", "c"], silent: [true, false, true], jumped: false };
  const playing = (segment: number) => ({ playing: true, segment, held: false });
  const paused = { playing: false, segment: 0, held: false };
  assert.deepEqual(speechCue(paused, playing(0), cues), { type: "speak", text: "a" });
  assert.deepEqual(speechCue(playing(0), playing(0), cues), { type: "none" });
  assert.deepEqual(speechCue(playing(0), playing(1), cues), { type: "cancel" });
  assert.deepEqual(speechCue(playing(1), playing(2), cues), { type: "speak", text: "c" });
  assert.deepEqual(speechCue(playing(2), { playing: false, segment: 2, held: false }, cues), { type: "cancel" });
  assert.deepEqual(speechCue(playing(2), { playing: true, segment: 2, held: true }, cues), { type: "cancel" });
  assert.deepEqual(speechCue(playing(0), playing(0), { ...cues, jumped: true }), { type: "speak", text: "a" });
});

test("part skips move between part starts and restart a part that is well underway", () => {
  const { clock } = scrimTimeline([seg({ durationMs: 10000 }), seg({ durationMs: 20000 }), seg()]);
  const [first, second, third] = clock.offsets;
  assert.equal(partSkipTarget(clock, first, "back"), first);
  assert.equal(partSkipTarget(clock, first + 1, "forward"), second);
  assert.equal(partSkipTarget(clock, second + 1, "back"), first);
  assert.equal(partSkipTarget(clock, second + 10, "back"), second);
  assert.equal(partSkipTarget(clock, second + 10, "forward"), third);
  assert.equal(partSkipTarget(clock, third + 1, "forward"), null);
});

test("a gate-only segment carries the previous code", () => {
  const plan = planScrim([seg({ edit: { code: "a = 1", run: false } }), seg({ gate: "step-1" })]);
  assert.equal(plan.edits.length, 2);
  assert.equal(plan.edits[1].code, "a = 1");
  assert.equal(plan.edits[1].predict, "step-1");
  assert.deepEqual(plan.stepByKey, { "edit-1": "step-1" });
});

test("the demo shape gates segment 1 and edits 0, 1 and 2", () => {
  const segments = [
    seg({ edit: { code: "a = 1", run: false } }),
    seg({ edit: { code: "a = 2", run: true }, gate: "q" }),
    seg({ edit: { code: "a = 3", run: false } }),
    seg(),
  ];
  const plan = planScrim(segments);
  assert.deepEqual(plan.edits.map((e) => e.segment), [0, 1, 2]);
  const scrim = scrimTimeline(segments);
  assert.equal(scrim.gates.length, 1);
  assert.equal(scrim.gates[0].t, 2);
  let state = playbackReducer(initPlayback(scrim, []), { type: "play" });
  state = playbackReducer(state, { type: "tick", t: 5 });
  assert.equal(state.t, 2);
  assert.equal(state.playing, false);
  assert.equal(heldGate(state)?.key, "edit-1");
  assert.equal(playbackReducer(state, { type: "play" }), state);
  state = playbackReducer(state, { type: "answer", key: "edit-1" });
  assert.equal(state.playing, true);
  state = playbackReducer(state, { type: "tick", t: 99 });
  assert.equal(state.t, 8);
  assert.equal(finished(state), true);
  assert.equal(playbackReducer(state, { type: "play" }).t, 0);
});

test("a reopened scrim resumes at the first unrevealed gate, or the start when none is open", () => {
  const segments = [
    seg({ edit: { code: "a = 1", run: false } }),
    seg({ gate: "step-1" }),
    seg({ edit: { code: "a = 2", run: false } }),
    seg({ gate: "step-2" }),
  ];
  const step = (id: string, state: Lesson["steps"][number]["state"]) => ({ id, idx: 0, title: id, hintCount: 1, state });
  const { clock } = scrimTimeline(segments);
  assert.equal(resumeTime(segments, [step("step-1", "predicting"), step("step-2", "predicting")]), clock.offsets[1]);
  assert.equal(resumeTime(segments, [step("step-1", "hinting"), step("step-2", "predicting")]), clock.offsets[1]);
  assert.equal(resumeTime(segments, [step("step-1", "revealed"), step("step-2", "predicting")]), clock.offsets[3]);
  assert.equal(resumeTime(segments, [step("step-1", "revealed"), step("step-2", "revealed")]), 0);
  assert.equal(resumeTime(segments, [step("step-1", "skipped"), step("step-2", "predicting")]), clock.offsets[1]);
});
