import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScrimTimeline, codeAt, openGate, reachable, runCrossed, scrimClock, segmentAt, shownEdits, type TimedEdit } from "./scrim.ts";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const edit = (segment: number, at: number, code: string, predict: string | null = null, run = false): TimedEdit => ({
  segment,
  at,
  cueHeard: true,
  cue: "",
  predict,
  code,
  run,
});

test("the clock joins the parts end to end and finds the part for any time", () => {
  const clock = scrimClock([5, 3, 4]);
  assert.deepEqual([clock.offsets, clock.total], [[0, 5, 8], 12]);
  assert.deepEqual(segmentAt(clock, 6.5), { index: 1, local: 1.5 });
  assert.deepEqual(segmentAt(clock, 0), { index: 0, local: 0 });
});

test("code at a time is the edits whose cue has passed, the newest typed partway", () => {
  const scrim = buildScrimTimeline([edit(0, 1, "a = 1"), edit(1, 1, "a = 1\nprint(a)")], [null, null], scrimClock([5, 5]));
  const none = new Set<string>();
  assert.equal(codeAt(scrim, none, 0.5), "");
  assert.equal(codeAt(scrim, none, 4), "a = 1");
  const partway = codeAt(scrim, none, 6.2);
  assert.ok(partway.startsWith("a = 1") && partway.length < "a = 1\nprint(a)".length, partway);
  assert.equal(codeAt(scrim, none, 10), "a = 1\nprint(a)");
  assert.equal(codeAt(scrim, none, 0.9), "", "seeking back takes the code back");
});

test("a question holds playback at its edit and hides that edit until answered", () => {
  const scrim = buildScrimTimeline([edit(0, 1, "a = 1"), edit(0, 3, "a = 2", "What changes?")], [null], scrimClock([6]));
  const none = new Set<string>();
  assert.equal(openGate(scrim, none)?.key, "edit-1");
  assert.equal(reachable(scrim, none, 5), 3);
  assert.equal(codeAt(scrim, none, 3), "a = 1");
  const answered = new Set(["edit-1"]);
  assert.equal(reachable(scrim, answered, 5), 5);
  assert.equal(codeAt(scrim, answered, 5), "a = 2");
});

test("a part's question holds playback at the end of that part", () => {
  const scrim = buildScrimTimeline([], ["Guess?", null], scrimClock([4, 4]));
  assert.ok(Math.abs(reachable(scrim, new Set(), 7) - 3.95) < 1e-9);
  assert.equal(reachable(scrim, new Set(["part-0"]), 7), 7);
});

test("a run fires once, after its edit has finished typing", () => {
  const scrim = buildScrimTimeline([edit(0, 1, "print(1)", null, true)], [null], scrimClock([10]));
  const run = scrim.runs[0];
  assert.ok(run.t > 1 + scrim.typing[0]);
  assert.equal(runCrossed(scrim, 0, run.t - 0.01), null);
  assert.deepEqual(runCrossed(scrim, run.t - 0.2, run.t + 0.2), run);
  assert.equal(runCrossed(scrim, run.t, run.t + 1), null);
});

test("for any scrim and any seek, no edit behind an open question ever shows, and code only grows while playing", () => {
  const rand = mulberry32(21);
  for (let n = 0; n < 1500; n++) {
    const parts = 1 + Math.floor(rand() * 3);
    const durations = Array.from({ length: parts }, () => 2 + rand() * 6);
    const edits = Array.from({ length: Math.floor(rand() * 6) }, (_, i) =>
      edit(Math.floor(rand() * parts), rand() * 8, `x${i} = ${i}`, rand() < 0.3 ? `q${i}` : null),
    ).sort((a, b) => a.segment - b.segment || a.at - b.at);
    const cumulative = edits.map((_, i) => edits.slice(0, i + 1).map((e) => e.code).join("\n"));
    const withCode = edits.map((e, i) => ({ ...e, code: cumulative[i] }));
    const predicts = durations.map((_, s) => (rand() < 0.3 ? `part ${s}` : null));
    const scrim = buildScrimTimeline(withCode, predicts, scrimClock(durations));
    const answered = new Set<string>();
    for (const g of scrim.gates) if (rand() < 0.5) answered.add(g.key);
    const seekTo = reachable(scrim, answered, rand() * scrim.clock.total * 1.2);
    const shown = shownEdits(scrim, answered, seekTo);
    for (let i = 0; i < shown; i++) {
      if (scrim.edits[i].predict) assert.ok(answered.has(`edit-${i}`), `run ${n}: edit ${i} shown before its question`);
    }
    const gate = openGate(scrim, answered);
    if (gate) assert.ok(seekTo <= gate.t, `run ${n}: seeked past an open question`);
    let length = codeAt(scrim, answered, 0).length;
    for (let t = 0; t <= seekTo; t += 0.1) {
      const now = codeAt(scrim, answered, t).length;
      assert.ok(now >= length, `run ${n}: code shrank at ${t.toFixed(1)}`);
      length = now;
    }
  }
});
