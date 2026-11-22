import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScrimTimeline, codeAt, editGateKey, frameAt, openGate, reachable, runCrossed, scrimClock, segmentAt, shownEdits, type TimedEdit } from "./scrim.ts";
import { editTimeline, scrimFile } from "./scrim-timeline.ts";

const FILE = scrimFile(undefined);

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
  id: `e${segment}@${at}:${code}`,
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
  const key = editGateKey(scrim.edits[1].id);
  assert.equal(openGate(scrim, none)?.key, key);
  assert.equal(reachable(scrim, none, 5), 3);
  assert.equal(codeAt(scrim, none, 3), "a = 1");
  const answered = new Set([key]);
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
  assert.deepEqual(runCrossed(scrim, 0, run.t - 0.01), []);
  assert.deepEqual(runCrossed(scrim, run.t - 0.2, run.t + 0.2), [run]);
  assert.deepEqual(runCrossed(scrim, run.t, run.t + 1), []);
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
      if (scrim.edits[i].predict) assert.ok(answered.has(editGateKey(scrim.edits[i].id)), `run ${n}: edit ${i} shown before its question`);
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

test("for any scrim, an empty or blank question makes no gate and never stalls its edit", () => {
  const rand = mulberry32(33);
  const blanks = ["", " ", "\n\t "];
  for (let n = 0; n < 500; n++) {
    const duration = 3 + rand() * 6;
    const at = rand() * duration * 0.5;
    const blank = blanks[Math.floor(rand() * blanks.length)];
    const blankPart = blanks[Math.floor(rand() * blanks.length)];
    const scrim = buildScrimTimeline([edit(0, at, "a = 1", blank)], [blankPart], scrimClock([duration]));
    assert.equal(scrim.gates.length, 0, `run ${n}: blank question made a gate`);
    assert.equal(reachable(scrim, new Set(), duration), duration);
    assert.equal(shownEdits(scrim, new Set(), duration), 1, `run ${n}: blank question left the edit hidden`);
    assert.equal(codeAt(scrim, new Set(), duration), "a = 1");
  }
});

test("for any scrim, every run lands between its edit and the end of the clock", () => {
  const rand = mulberry32(44);
  for (let n = 0; n < 1000; n++) {
    const parts = 1 + Math.floor(rand() * 3);
    const durations = Array.from({ length: parts }, () => 1 + rand() * 5);
    const edits = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) =>
      edit(Math.floor(rand() * parts), rand() * 6, `x${i} = ${"y".repeat(Math.floor(rand() * 40))}`, null, rand() < 0.7),
    );
    const scrim = buildScrimTimeline(edits, durations.map(() => null), scrimClock(durations));
    for (const run of scrim.runs) {
      assert.ok(run.t >= scrim.times[run.edit] + scrim.typing[run.edit], `run ${n}: run before its edit finished typing`);
      assert.ok(run.t <= scrim.clock.total, `run ${n}: run at ${run.t} after the clock ends at ${scrim.clock.total}`);
    }
  }
});

test("a run near the end of the clock is still crossed by playing to the end", () => {
  const scrim = buildScrimTimeline([edit(0, 3.9, "print(1)", null, true)], [null], scrimClock([4]));
  assert.equal(runCrossed(scrim, 0, scrim.clock.total).length, 1);
});

test("for any scrim, a frame shows the same code as codeAt, and typing at full speed with distinct edit times adds at most two characters per 16 ms", () => {
  const rand = mulberry32(66);
  for (let n = 0; n < 500; n++) {
    const parts = 1 + Math.floor(rand() * 3);
    const durations = Array.from({ length: parts }, () => 2 + rand() * 6);
    const edits = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) =>
      edit(Math.floor(rand() * parts), rand() * 8, Array.from({ length: i + 1 }, (_, k) => `x${k} = ${k}`).join("\n"), null, rand() < 0.5),
    );
    const scrim = buildScrimTimeline(edits, durations.map(() => null), scrimClock(durations));
    const distinct = scrim.times.every((time, i) => i === 0 || time > scrim.times[i - 1]);
    const answered = new Set<string>();
    const squeezed = scrim.edits.map((e, i) => {
      const before = i > 0 ? scrim.edits[i - 1].code : "";
      return scrim.typing[i] + 1e-9 < editTimeline(before, e.code, FILE).duration / 1000;
    });
    for (let t = 0; t <= scrim.clock.total; t += 0.016) {
      const frame = frameAt(scrim, answered, t);
      assert.equal(frame.files[FILE] ?? "", codeAt(scrim, answered, t), `run ${n}: frame differs from codeAt at ${t}`);
      assert.equal(frame.activePath, FILE);
      if (!distinct) continue;
      const from = shownEdits(scrim, answered, t);
      const to = shownEdits(scrim, answered, t + 0.016);
      if (squeezed.slice(Math.max(0, from - 1), to).some(Boolean)) continue;
      const next = codeAt(scrim, answered, t + 0.016);
      assert.ok(next.length - codeAt(scrim, answered, t).length <= 2, `run ${n}: 16 ms added more than two characters at ${t}`);
    }
  }
});

const HOSTILE_TIMES = [-5, -0.001, 0, 0, 0.02, 1, 1, 2.5, 9, 1e6, Infinity, -Infinity];
const DURATIONS = [0, 0.01, 0.04, 0.05, 0.3, 1, 2.5, 6];

function hostileScrim(rand: () => number, language?: string) {
  const durations = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => DURATIONS[Math.floor(rand() * DURATIONS.length)]);
  const edits = Array.from({ length: Math.floor(rand() * 7) }, (_, i) => {
    const at = HOSTILE_TIMES[Math.floor(rand() * HOSTILE_TIMES.length)];
    return { ...edit(Math.floor(rand() * durations.length), at, `x${i} = ${i}`, rand() < 0.4 ? `q${i}` : null, rand() < 0.5), id: `step-${i}` };
  });
  const predicts = durations.map((_, s) => (rand() < 0.4 ? `part ${s}` : null));
  return { durations, edits, predicts, clock: scrimClock(durations), language };
}

const finiteEdits = (edits: TimedEdit[]) => edits.map((e) => (Number.isFinite(e.at) ? e : { ...e, at: e.at > 0 ? 1e6 : -5 }));

test("for any scrim, edit times stay in their own part, in order, and gates stay inside the clock in order", () => {
  const rand = mulberry32(101);
  for (let n = 0; n < 2000; n++) {
    const { edits, predicts, clock } = hostileScrim(rand);
    const scrim = buildScrimTimeline(finiteEdits(edits), predicts, clock);
    scrim.edits.forEach((e, i) => {
      const start = clock.offsets[e.segment];
      const end = start + clock.durations[e.segment];
      assert.ok(scrim.times[i] >= start && scrim.times[i] <= end, `run ${n}: edit ${i} at ${scrim.times[i]} outside part [${start}, ${end}]`);
      assert.ok(scrim.typing[i] >= 0, `run ${n}: negative typing`);
      if (i > 0) assert.ok(scrim.times[i] >= scrim.times[i - 1], `run ${n}: times went backwards at ${i}`);
    });
    scrim.gates.forEach((g, i) => {
      assert.ok(Number.isFinite(g.t) && g.t >= 0 && g.t <= clock.total, `run ${n}: gate ${g.key} at ${g.t} outside the clock`);
      if (i > 0) assert.ok(g.t >= scrim.gates[i - 1].t, `run ${n}: gates out of order`);
    });
    const partGates = scrim.gates.filter((g) => g.key.startsWith("part-"));
    for (const g of partGates) {
      const s = Number(g.key.slice("part-".length));
      assert.ok(g.t >= clock.offsets[s], `run ${n}: part ${s} gate before its part starts`);
    }
  }
});

test("for any scrim, a part's question hides every later edit until it is answered, wherever the playhead is", () => {
  const rand = mulberry32(202);
  for (let n = 0; n < 2000; n++) {
    const { edits, predicts, clock } = hostileScrim(rand);
    const scrim = buildScrimTimeline(finiteEdits(edits), predicts, clock);
    const answered = new Set<string>();
    for (const g of scrim.gates) if (rand() < 0.5) answered.add(g.key);
    const gate = openGate(scrim, answered);
    if (!gate) continue;
    for (const t of [gate.t, gate.t + 0.01, clock.total, clock.total * 2, 1e9]) {
      const shown = shownEdits(scrim, answered, t);
      for (let i = 0; i < shown; i++) {
        assert.ok(scrim.times[i] <= gate.t, `run ${n}: edit ${i} at ${scrim.times[i]} shown past open gate ${gate.key} at ${gate.t}`);
      }
    }
  }
});

test("a negative or past-the-end cue time stays inside its own part and never skips an earlier part's question", () => {
  const clock = scrimClock([4, 4]);
  const early = buildScrimTimeline([edit(0, 1, "a = 1"), edit(1, -3, "a = 2")], ["Guess?", null], clock);
  assert.equal(early.times[1], clock.offsets[1]);
  assert.equal(codeAt(early, new Set(), 7), "a = 1");
  assert.equal(codeAt(early, new Set(["part-0"]), 7), "a = 2");
  const late = buildScrimTimeline([edit(0, 99, "a = 1")], [null], scrimClock([4]));
  assert.equal(late.times[0], 4);
});

test("a cue time that is not a number, or a part that does not exist, is rejected instead of building a timeline", () => {
  const clock = scrimClock([4, 4]);
  for (const at of [NaN, Infinity, -Infinity]) {
    assert.throws(() => buildScrimTimeline([edit(0, at, "a = 1")], [null, null], clock), RangeError, `at ${at}`);
  }
  for (const segment of [-1, 2, 0.5, NaN]) {
    assert.throws(() => buildScrimTimeline([edit(segment, 1, "a = 1")], [null, null], clock), RangeError, `segment ${segment}`);
  }
  for (const bad of [NaN, -1, Infinity]) {
    assert.throws(() => buildScrimTimeline([], [null], scrimClock([bad])), RangeError, `duration ${bad}`);
  }
  const twin = edit(0, 1, "a = 1", "q");
  assert.throws(() => buildScrimTimeline([twin, { ...twin, at: 2 }], [null], scrimClock([4])), RangeError);
});

test("for any time, even NaN or past the end, the playhead and part lookup stay finite and inside the clock", () => {
  const rand = mulberry32(303);
  for (let n = 0; n < 1000; n++) {
    const { edits, predicts, clock } = hostileScrim(rand);
    const scrim = buildScrimTimeline(finiteEdits(edits), predicts, clock);
    const answered = new Set<string>();
    for (const g of scrim.gates) if (rand() < 0.5) answered.add(g.key);
    for (const t of [NaN, -1, 0, clock.total, clock.total + 3, Infinity, -Infinity, rand() * clock.total]) {
      const at = reachable(scrim, answered, t);
      assert.ok(Number.isFinite(at) && at >= 0 && at <= clock.total, `run ${n}: reachable(${t}) = ${at}`);
      const part = segmentAt(clock, t);
      assert.ok(part.index >= 0 && part.index < clock.durations.length, `run ${n}: segmentAt(${t}).index = ${part.index}`);
      assert.ok(part.local >= 0 && part.local <= clock.durations[part.index], `run ${n}: segmentAt(${t}).local = ${part.local}`);
    }
  }
});

test("for any scrim, crossing a window reports every run in it, in time order, and windows that tile the clock report each run once", () => {
  const rand = mulberry32(404);
  for (let n = 0; n < 1000; n++) {
    const { edits, predicts, clock } = hostileScrim(rand);
    const scrim = buildScrimTimeline(finiteEdits(edits), predicts, clock);
    const inWindow = (from: number, to: number) => scrim.runs.filter((r) => from < r.t && r.t <= to);
    const from = rand() * clock.total;
    const to = from + rand() * clock.total;
    assert.deepEqual(runCrossed(scrim, from, to), inWindow(from, to), `run ${n}`);
    const cuts = [-1, ...Array.from({ length: 4 }, () => rand() * clock.total).sort((a, b) => a - b), clock.total];
    const tiled = cuts.slice(1).flatMap((cut, i) => runCrossed(scrim, cuts[i], cut));
    assert.deepEqual(tiled, runCrossed(scrim, -1, clock.total), `run ${n}: tiled windows lost or doubled a run`);
    assert.equal(runCrossed(scrim, -1, clock.total).length, scrim.runs.length, `run ${n}: whole clock missed a run`);
  }
});

test("for any order the edits are listed in, each question keeps its own gate key", () => {
  const rand = mulberry32(505);
  for (let n = 0; n < 500; n++) {
    const { edits, predicts, clock } = hostileScrim(rand);
    const base = finiteEdits(edits);
    const shuffled = [...base].sort(() => rand() - 0.5);
    const questions = (list: TimedEdit[]) => buildScrimTimeline(list, predicts, clock).gates.map((g) => `${g.key}=${g.question}`).sort();
    assert.deepEqual(questions(shuffled), questions(base), `run ${n}`);
    for (const e of base.filter((x) => x.predict?.trim())) {
      assert.ok(buildScrimTimeline(shuffled, predicts, clock).gates.some((g) => g.key === editGateKey(e.id) && g.question === e.predict), `run ${n}: ${e.id} lost its key`);
    }
  }
});

test("the scrim names its file after the language", () => {
  const clock = scrimClock([4]);
  const scrim = buildScrimTimeline([edit(0, 1, "let a = 1")], [null], clock, "typescript");
  assert.equal(scrim.file, "main.ts");
  assert.deepEqual(Object.keys(frameAt(scrim, new Set(), 3).files), ["main.ts"]);
  assert.equal(frameAt(scrim, new Set(), 3).activePath, "main.ts");
});
