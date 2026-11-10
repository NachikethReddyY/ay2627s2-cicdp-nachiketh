import test from "node:test";
import assert from "node:assert/strict";
import { createActor } from "xstate";
import {
  stepMachine,
  canSubmit,
  canHint,
  canSkip,
  type AttemptResult,
  type Reveal,
  type StepPublic,
} from "./stepMachine.ts";

const step = (o: Partial<StepPublic> = {}): StepPublic => ({
  id: "s1", idx: 0, title: "t", prompt: "p", kind: "mcq", options: ["a", "b", "c", "d"],
  hintCount: 2, state: "predicting", rungsTaken: 0, attemptAllowed: true, hints: [], beforeFiles: {}, ...o,
});
const result = (o: Partial<AttemptResult> = {}): AttemptResult => ({
  attemptId: "a", correct: false, feedback: "Not quite.", missedConcepts: [], hintsUsed: 0,
  state: "hinting", attemptAllowed: false, ...o,
});
const reveal: Reveal = {
  answer: { type: "mcq", index: 0 }, hunks: [],
  explanations: { workedExample: "w", practice: "p", inferred: true },
  narration: "w",
  source: { repo: "r", sha: "s", path: "p" },
};
const hint = (rung: number) => ({ rung, text: `h${rung}` });

function actorAt(state: StepPublic["state"] = "predicting", lessonSteps = 3, idx = 0) {
  const a = createActor(stepMachine, { input: { lessonSteps, idx } }).start();
  a.send({ type: "LOADED", step: step({ state }) });
  return a;
}
const val = (a: ReturnType<typeof actorAt>) => a.getSnapshot().value;

test("starts in browse with input idx", () => {
  const a = createActor(stepMachine, { input: { lessonSteps: 3, idx: 1 } }).start();
  assert.equal(val(a), "browse");
  assert.equal(a.getSnapshot().context.idx, 1);
});

for (const s of ["predicting", "hinting", "revealed", "skipped"] as const) {
  test(`LOADED routes ${s}`, () => {
    const a = createActor(stepMachine, { input: { lessonSteps: 3 } }).start();
    a.send({ type: "LOADED", step: step({ state: s, hints: [hint(1)], attemptAllowed: false }) });
    assert.equal(val(a), s);
    assert.equal(a.getSnapshot().context.hints.length, 1);
    assert.equal(a.getSnapshot().context.attemptAllowed, false);
  });
}

for (const from of ["predicting", "hinting"] as const) {
  test(`${from}: RESULT correct -> revealed`, () => {
    const a = actorAt(from);
    a.send({ type: "RESULT", r: result({ correct: true, state: "revealed" }) });
    assert.equal(val(a), "revealed");
    assert.equal(a.getSnapshot().context.lastCorrect, true);
  });
  test(`${from}: RESULT miss -> hinting, stores feedback`, () => {
    const a = actorAt(from);
    a.send({ type: "RESULT", r: result() });
    assert.equal(val(a), "hinting");
    assert.equal(a.getSnapshot().context.feedback, "Not quite.");
    assert.equal(a.getSnapshot().context.attemptAllowed, false);
  });
  test(`${from}: HINT appends and allows attempt`, () => {
    const a = actorAt(from);
    a.send({ type: "HINT", hint: hint(1) });
    assert.equal(val(a), "hinting");
    assert.equal(a.getSnapshot().context.hints.length, 1);
    assert.equal(a.getSnapshot().context.attemptAllowed, true);
  });
  test(`${from}: SKIPPED -> skipped`, () => {
    const a = actorAt(from);
    a.send({ type: "SKIPPED" });
    assert.equal(val(a), "skipped");
  });
  test(`${from}: CONFLICT -> browse with notice`, () => {
    const a = actorAt(from);
    a.send({ type: "CONFLICT", msg: "out of sync" });
    assert.equal(val(a), "browse");
    assert.equal(a.getSnapshot().context.notice, "out of sync");
  });
}

for (const s of ["revealed", "skipped"] as const) {
  test(`${s}: REVEAL_LOADED stays and stores`, () => {
    const a = actorAt(s);
    a.send({ type: "REVEAL_LOADED", reveal });
    assert.equal(val(a), s);
    assert.equal(a.getSnapshot().context.reveal, reveal);
  });
  test(`${s}: NEXT -> browse, idx+1, step context reset`, () => {
    const a = actorAt(s);
    a.send({ type: "REVEAL_LOADED", reveal });
    a.send({ type: "NEXT" });
    const c = a.getSnapshot().context;
    assert.equal(val(a), "browse");
    assert.equal(c.idx, 1);
    assert.deepEqual([c.step, c.hints, c.feedback, c.lastCorrect, c.reveal, c.notice], [null, [], null, null, null, null]);
  });
}

test("NEXT on last step -> finished", () => {
  const a = actorAt("revealed", 3, 2);
  a.send({ type: "NEXT" });
  assert.equal(val(a), "finished");
});

test("canSubmit false after wrong RESULT, true again after HINT", () => {
  const a = actorAt();
  assert.equal(canSubmit(a.getSnapshot()), true);
  a.send({ type: "RESULT", r: result({ attemptAllowed: false }) });
  assert.equal(canSubmit(a.getSnapshot()), false);
  a.send({ type: "HINT", hint: hint(1) });
  assert.equal(canSubmit(a.getSnapshot()), true);
});

test("canHint stops at hintCount; canSkip false once revealed", () => {
  const a = actorAt();
  assert.equal(canHint(a.getSnapshot()), true);
  a.send({ type: "HINT", hint: hint(1) });
  a.send({ type: "HINT", hint: hint(2) });
  assert.equal(canHint(a.getSnapshot()), false);
  assert.equal(canSkip(a.getSnapshot()), true);
  a.send({ type: "SKIPPED" });
  assert.equal(canSkip(a.getSnapshot()), false);
});

test("CONFLICT notice survives the re-sync LOADED, clears on the next HINT", () => {
  const a = actorAt("hinting");
  a.send({ type: "CONFLICT", msg: "Take the next hint before trying again." });
  a.send({ type: "LOADED", step: step({ state: "hinting", attemptAllowed: false }) });
  assert.equal(val(a), "hinting");
  assert.equal(a.getSnapshot().context.notice, "Take the next hint before trying again.");
  a.send({ type: "HINT", hint: hint(1) });
  assert.equal(a.getSnapshot().context.notice, null);
});
