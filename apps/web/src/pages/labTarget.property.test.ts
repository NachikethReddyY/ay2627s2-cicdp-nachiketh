import assert from "node:assert/strict";
import test from "node:test";
import type { Part } from "../player/live/types";
import { labTarget } from "./labTarget.ts";

const RUNS = 300;
const KINDS = ["learn", "watch", "practice", "game-practice", "scrim"] as const;

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

const word = (rand: () => number) => Math.floor(rand() * 1e9).toString(36);

function randomLab(rand: () => number) {
  const tests = Array.from({ length: Math.floor(rand() * 4) }, () =>
    rand() < 0.5
      ? { id: word(rand), name: word(rand), stretch: false, visibility: "sample", stdin: word(rand) }
      : { id: word(rand), name: word(rand), stretch: true, visibility: "hidden" },
  );
  return { kind: "practice", instructions: word(rand), language: "javascript", starterCode: word(rand), tests };
}

function randomPart(rand: () => number) {
  const kind = KINDS[Math.floor(rand() * KINDS.length)];
  const lab = randomLab(rand);
  const locked = kind === "scrim" && rand() < 0.5;
  const part = kind === "practice" ? lab : kind === "scrim" ? { kind, language: "javascript", segments: [{ text: word(rand), durationMs: 1000 }], lab, labLocked: locked } : { kind };
  return { kind, lab, locked, part: part as unknown as Part };
}

test("a lab opens only for a practice lesson or a scrim, and then it is the practice part itself", () => {
  const rand = mulberry32(0x1ab);
  for (let i = 0; i < RUNS; i++) {
    const { kind, lab, part, locked } = randomPart(rand);
    const result = labTarget({ part });
    if (locked) {
      assert.ok("error" in result);
      assert.equal(result.locked, true);
    } else if (kind === "practice" || kind === "scrim") {
      assert.ok("part" in result, `${kind} should open a lab`);
      assert.deepEqual(result.part, lab);
      assert.equal(result.origin, kind);
    } else {
      assert.ok("error" in result, `${kind} should not open a lab`);
      assert.match(result.error, new RegExp(kind));
    }
  }
});

test("opening a lab never adds a field the lesson did not send", () => {
  const rand = mulberry32(0x2cd);
  for (let i = 0; i < RUNS; i++) {
    const { kind, lab, part } = randomPart(rand);
    const result = labTarget({ part });
    if (!("part" in result)) continue;
    assert.deepEqual(Object.keys(result).sort(), ["origin", "part"], kind);
    assert.deepEqual(Object.keys(result.part).sort(), Object.keys(lab).sort(), kind);
    for (const test of result.part.tests) {
      const sent = lab.tests.find((t) => t.id === test.id);
      assert.deepEqual(Object.keys(test).sort(), Object.keys(sent ?? {}).sort());
    }
  }
});
