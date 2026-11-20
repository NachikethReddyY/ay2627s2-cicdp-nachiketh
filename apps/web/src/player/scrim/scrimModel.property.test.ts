import test from "node:test";
import assert from "node:assert/strict";
import { codeAt, reachable, openGate } from "@learnquest/player-core";
import { codeShown, heldGate, initPlayback, partSkipTarget, planScrim, playbackReducer, scrimTimeline, type Playback, type PlaybackAction } from "./scrimModel.ts";
import type { Part } from "../live/types.ts";

type Segment = Extract<Part, { kind: "scrim" }>["segments"][number];

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

const CASES = 300;

function randomSegments(rand: () => number): Segment[] {
  const count = 1 + Math.floor(rand() * 6);
  let marker = 0;
  return Array.from({ length: count }, (_, i) => {
    const segment: Segment = { text: `s${i}`, durationMs: 500 + Math.floor(rand() * 5000) };
    if (rand() < 0.7) {
      const code = Array.from({ length: marker + 1 }, (_, k) => `m${k}`).join("\n");
      marker += 1;
      segment.edit = { code, run: rand() < 0.3 };
    }
    if (rand() < 0.4) segment.gate = `step-${i}`;
    return segment;
  });
}

function randomAction(rand: () => number, state: Playback): PlaybackAction {
  const total = state.scrim.clock.total;
  const pick = rand();
  if (pick < 0.2) return { type: "play" };
  if (pick < 0.3) return { type: "pause" };
  if (pick < 0.6) return { type: "tick", t: rand() * (total + 2) };
  if (pick < 0.8) return { type: "seek", t: rand() * (total + 2) - 1 };
  const gate = openGate(state.scrim, state.answered);
  const key = gate && rand() < 0.8 ? gate.key : `bogus-${Math.floor(rand() * 3)}`;
  return { type: "answer", key };
}

test("playback invariants hold for random segments and action sequences", () => {
  for (let seed = 1; seed <= CASES; seed++) {
    const rand = mulberry32(seed);
    const segments = randomSegments(rand);
    const scrim = scrimTimeline(segments);
    const gateKeys = new Set(scrim.gates.map((g) => g.key));
    let state = initPlayback(scrim, []);
    for (let step = 0; step < 40; step++) {
      const action = randomAction(rand, state);
      const next = playbackReducer(state, action);
      const where = `seed ${seed} step ${step} ${JSON.stringify(action)}`;
      assert.equal(next.t, reachable(scrim, next.answered, next.t), where);
      assert.ok(next.t >= 0 && next.t <= scrim.clock.total, where);
      if (heldGate(next)) assert.equal(next.playing, false, where);
      assert.ok([...state.answered].every((k) => next.answered.has(k)), where);
      assert.ok([...next.answered].every((k) => gateKeys.has(k)), where);
      if (action.type === "play" && heldGate(state)) assert.equal(next, state, where);
      const lines = codeShown(next).split("\n");
      const lockedFrom = scrim.edits.findIndex((e, i) => e.predict !== null && !next.answered.has(`edit-${i}`));
      if (lockedFrom >= 0) {
        const markers = lines.filter((l) => /^m\d+$/.test(l)).map((l) => Number(l.slice(1)));
        const lockedMarkers = scrim.edits.slice(lockedFrom).flatMap((e) => e.code.split("\n").map((l) => Number(l.slice(1))));
        const earlier = new Set(scrim.edits.slice(0, lockedFrom).flatMap((e) => e.code.split("\n").map((l) => Number(l.slice(1)))));
        const leaked = markers.filter((m) => lockedMarkers.includes(m) && !earlier.has(m));
        assert.deepEqual(leaked, [], where);
        assert.equal(codeShown(next), codeAt(scrim, next.answered, next.t), where);
      }
      state = next;
    }
  }
});

test("planScrim puts every gate at its segment start and maps it to its step", () => {
  for (let seed = 1; seed <= CASES; seed++) {
    const rand = mulberry32(seed * 7919);
    const segments = randomSegments(rand);
    const plan = planScrim(segments);
    const scrim = scrimTimeline(segments);
    const gated = segments.map((s, i) => ({ s, i })).filter(({ s }) => s.gate);
    assert.equal(scrim.gates.length, gated.length, `seed ${seed}`);
    for (const { s, i } of gated) {
      const index = plan.edits.findIndex((e) => e.segment === i);
      const gate = scrim.gates.find((g) => g.key === `edit-${index}`);
      assert.ok(gate, `seed ${seed} segment ${i}`);
      assert.equal(gate.t, scrim.clock.offsets[i], `seed ${seed} segment ${i}`);
      assert.equal(plan.stepByKey[gate.key], s.gate, `seed ${seed} segment ${i}`);
    }
  }
});

test("part skips land on part starts: forward moves ahead, back never passes the playhead", () => {
  for (let seed = 1; seed <= CASES; seed++) {
    const rand = mulberry32(seed);
    const { clock } = scrimTimeline(randomSegments(rand));
    for (let i = 0; i < 40; i++) {
      const t = rand() * clock.total;
      const forward = partSkipTarget(clock, t, "forward");
      const back = partSkipTarget(clock, t, "back");
      if (forward !== null) assert.ok(clock.offsets.includes(forward) && forward > t, `seed ${seed}, t ${t}`);
      assert.ok(back !== null && clock.offsets.includes(back) && back <= t, `seed ${seed}, t ${t}`);
    }
  }
});
