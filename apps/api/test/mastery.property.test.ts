import "./helpers.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { BKT_DEFAULTS, mergeBkt, observationOf, type AttemptFacts } from "../src/progress/mastery.ts";

const RUNS = 2000;

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

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

function randomFacts(rand: () => number): AttemptFacts {
  return {
    observed: rand() < 0.7,
    kind: pick(rand, ["mcq", "cloze", "skip"] as const),
    correct: pick(rand, [true, false, null] as const),
    hintsUsed: Math.floor(rand() * 4),
  };
}

function randomJunk(rand: () => number): unknown {
  const makers: (() => unknown)[] = [
    () => rand() * 4 - 2,
    () => pick(rand, [NaN, Infinity, -Infinity, 0, 0.5, 1, -0]),
    () => "0.3",
    () => null,
    () => undefined,
    () => ({}),
    () => [],
    () => true,
  ];
  return pick(rand, makers)();
}

function randomConfig(rand: () => number): unknown {
  const shape = Math.floor(rand() * 6);
  if (shape === 0) return randomJunk(rand);
  const cfg: Record<string, unknown> = {};
  for (const key of ["pSlip", "pLearn", "pInit", "pGuess", "extra"]) {
    if (rand() < 0.6) cfg[key] = randomJunk(rand);
  }
  return cfg;
}

const silenced = <T>(fn: () => T): T => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
};

test("only an observed, unassisted, correct answer counts as correct", () => {
  const rand = mulberry32(1);
  for (let i = 0; i < RUNS; i++) {
    const facts = randomFacts(rand);
    const obs = observationOf(facts);
    const cleanCorrect = facts.observed && facts.kind !== "skip" && facts.correct === true && facts.hintsUsed === 0;
    if (!facts.observed) assert.equal(obs, null, JSON.stringify(facts));
    else if (cleanCorrect) assert.equal(obs, "correct", JSON.stringify(facts));
    else assert.equal(obs, "incorrect", JSON.stringify(facts));
  }
});

test("hints, skips and wrong answers never produce a correct observation", () => {
  const rand = mulberry32(2);
  for (let i = 0; i < RUNS; i++) {
    const facts = randomFacts(rand);
    const assisted = facts.hintsUsed > 0 || facts.kind === "skip" || facts.correct !== true;
    if (assisted) assert.notEqual(observationOf(facts), "correct", JSON.stringify(facts));
  }
});

test("adding a hint to an attempt can only make its observation worse", () => {
  const rand = mulberry32(3);
  const rank = { incorrect: 0, correct: 1 } as const;
  for (let i = 0; i < RUNS; i++) {
    const facts = randomFacts(rand);
    const withHint = { ...facts, hintsUsed: facts.hintsUsed + 1 };
    const a = observationOf(facts);
    const b = observationOf(withHint);
    if (a === null) assert.equal(b, null);
    else assert.ok(rank[b as "correct" | "incorrect"] <= rank[a], JSON.stringify(facts));
  }
});

test("merged BKT parameters always sit inside the engine ranges, whatever the world config holds", () => {
  const rand = mulberry32(4);
  for (let i = 0; i < RUNS; i++) {
    const cfg = randomConfig(rand);
    const merged = silenced(() => mergeBkt(cfg, "property"));
    if (merged === undefined) continue;
    assert.ok(Number.isFinite(merged.pSlip) && merged.pSlip > 0 && merged.pSlip < 0.5, JSON.stringify([cfg, merged]));
    assert.ok(Number.isFinite(merged.pLearn) && merged.pLearn >= 0 && merged.pLearn <= 1, JSON.stringify([cfg, merged]));
    assert.ok(Number.isFinite(merged.pInit) && merged.pInit >= 0 && merged.pInit <= 1, JSON.stringify([cfg, merged]));
    assert.ok(!("pGuess" in merged), "pGuess is never forwarded");
  }
});

test("a missing or non-object config means engine defaults, and an empty object means explicit defaults", () => {
  assert.equal(silenced(() => mergeBkt(null, "p")), undefined);
  assert.equal(silenced(() => mergeBkt([], "p")), undefined);
  assert.equal(silenced(() => mergeBkt("x", "p")), undefined);
  assert.deepEqual(mergeBkt({}, "p"), BKT_DEFAULTS);
});

test("merging is idempotent: feeding merged parameters back changes nothing", () => {
  const rand = mulberry32(5);
  for (let i = 0; i < RUNS; i++) {
    const merged = silenced(() => mergeBkt(randomConfig(rand), "property"));
    if (merged === undefined) continue;
    assert.deepEqual(silenced(() => mergeBkt(merged, "again")), merged);
  }
});
