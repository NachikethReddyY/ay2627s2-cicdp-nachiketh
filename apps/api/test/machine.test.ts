import { test } from "node:test";
import assert from "node:assert/strict";
import { fresh, next, type Action, type Progress } from "../src/attempts/machine.ts";

const step = { hintCount: 2 };
const P = (o: Partial<Progress>): Progress => ({ ...fresh(), ...o });
const wrong: Action = { type: "attempt", correct: false };
const right: Action = { type: "attempt", correct: true };

function ok(p: Progress, a: Action) {
  const r = next(p, a, step);
  assert.ok("progress" in r, "expected a transition");
  return r;
}

for (const state of ["revealed", "skipped"] as const) {
  for (const a of [right, { type: "hint" } as Action, { type: "skip" } as Action]) {
    test(`${state} + ${a.type} -> conflict`, () => {
      assert.ok("conflict" in next(P({ state }), a, step));
    });
  }
}

test("hinting + attempt with !attemptAllowed -> conflict", () => {
  assert.ok("conflict" in next(P({ state: "hinting", attemptAllowed: false }), wrong, step));
});
test("predicting + correct -> revealed", () => {
  assert.equal(ok(P({}), right).progress.state, "revealed");
});
test("hinting + correct -> revealed", () => {
  assert.equal(ok(P({ state: "hinting", rungsTaken: 1 }), right).progress.state, "revealed");
});
test("predicting + wrong -> hinting, attempt blocked", () => {
  const { progress } = ok(P({}), wrong);
  assert.deepEqual(progress, { state: "hinting", rungsTaken: 0, attemptAllowed: false, retryAllowed: false });
});
test("hinting + wrong + retryAllowed -> revealed", () => {
  const { progress } = ok(P({ state: "hinting", rungsTaken: 2, retryAllowed: true }), wrong);
  assert.equal(progress.state, "revealed");
  assert.equal(progress.retryAllowed, false);
});
test("hinting + wrong on last rung -> retry offered, attempt allowed", () => {
  const { progress } = ok(P({ state: "hinting", rungsTaken: 2 }), wrong);
  assert.deepEqual(progress, { state: "hinting", rungsTaken: 2, attemptAllowed: true, retryAllowed: true });
});
test("hinting + wrong with rungs left -> attempt blocked", () => {
  const { progress } = ok(P({ state: "hinting", rungsTaken: 1 }), wrong);
  assert.deepEqual(progress, { state: "hinting", rungsTaken: 1, attemptAllowed: false, retryAllowed: false });
});
test("hint with all rungs used -> conflict", () => {
  assert.ok("conflict" in next(P({ state: "hinting", rungsTaken: 2 }), { type: "hint" }, step));
});
test("hint with rungs left -> next rung, hinting, attempt allowed", () => {
  const r = ok(P({ state: "hinting", rungsTaken: 1, attemptAllowed: false }), { type: "hint" });
  assert.deepEqual(r.progress, { state: "hinting", rungsTaken: 2, attemptAllowed: true, retryAllowed: false });
  assert.deepEqual(r.outcome, { type: "hint", rung: 2 });
});
test("predicting + skip -> skipped", () => {
  assert.equal(ok(P({}), { type: "skip" }).progress.state, "skipped");
});
test("hinting + skip -> skipped", () => {
  assert.equal(ok(P({ state: "hinting", rungsTaken: 1 }), { type: "skip" }).progress.state, "skipped");
});

test("no hints: predicting + wrong -> retry offered, attempt allowed (not stuck)", () => {
  const r = next(P({}), wrong, { hintCount: 0 });
  assert.ok("progress" in r);
  assert.deepEqual(r.progress, { state: "hinting", rungsTaken: 0, attemptAllowed: true, retryAllowed: true });
});
test("no hints: the retry ends the step either way", () => {
  const first = next(P({}), wrong, { hintCount: 0 });
  assert.ok("progress" in first);
  const second = next(first.progress, wrong, { hintCount: 0 });
  assert.ok("progress" in second);
  assert.equal(second.progress.state, "revealed");
  const ok2 = next(first.progress, right, { hintCount: 0 });
  assert.ok("progress" in ok2);
  assert.equal(ok2.progress.state, "revealed");
});

const gated = { hintCount: 0, triesBeforeAnswer: 3 };
test("three-try rule: wrong attempts one and two keep the step open, the third finishes it", () => {
  const first = next(P({}), wrong, { ...gated, triesMade: 0 });
  assert.ok("progress" in first);
  assert.deepEqual(first.progress, { state: "hinting", rungsTaken: 0, attemptAllowed: true, retryAllowed: true });
  const second = next(first.progress, wrong, { ...gated, triesMade: 1 });
  assert.ok("progress" in second);
  assert.deepEqual(second.progress, { state: "hinting", rungsTaken: 0, attemptAllowed: true, retryAllowed: true });
  const third = next(second.progress, wrong, { ...gated, triesMade: 2 });
  assert.ok("progress" in third);
  assert.equal(third.progress.state, "revealed");
});
test("three-try rule: a correct answer keeps the step open until the third attempt", () => {
  const first = next(P({}), right, { ...gated, triesMade: 0 });
  assert.ok("progress" in first);
  assert.deepEqual(first.progress, { state: "hinting", rungsTaken: 0, attemptAllowed: true, retryAllowed: true });
  const second = next(first.progress, right, { ...gated, triesMade: 1 });
  assert.ok("progress" in second);
  assert.equal(second.progress.state, "hinting");
  const third = next(second.progress, right, { ...gated, triesMade: 2 });
  assert.ok("progress" in third);
  assert.equal(third.progress.state, "revealed");
});
test("three-try rule: skip needs the tries first, scrim rules (0) skip freely", () => {
  assert.ok("conflict" in next(P({}), { type: "skip" }, { ...gated, triesMade: 2 }));
  const enough = next(P({}), { type: "skip" }, { ...gated, triesMade: 3 });
  assert.ok("progress" in enough);
  assert.equal(enough.progress.state, "skipped");
  const free = next(P({}), { type: "skip" }, { hintCount: 0, triesBeforeAnswer: 0, triesMade: 0 });
  assert.ok("progress" in free);
});
