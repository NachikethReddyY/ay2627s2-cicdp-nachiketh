import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, hasChecks, offersNext, startStage } from "./readFlow.ts";

const open = { state: "predicting" as const };
const wrong = { state: "hinting" as const };
const done = { state: "revealed" as const };

test("a learn or watch lesson starts with its opening prediction", () => {
  assert.equal(startStage([open, open], false), "opening");
  assert.equal(startStage([wrong, open], false), "opening");
});

test("a revealed opening resumes at reading, and an unattempted closing check is not terminal", () => {
  assert.equal(startStage([done, open], false), "reading");
  assert.equal(offersNext(startStage([done, open], false)), false);
});

test("a skipped step never opens the lesson or offers next", () => {
  assert.equal(startStage([{ state: "skipped" }, open], false), "opening");
  const skippedClosing = startStage([done, { state: "skipped" }], false);
  assert.equal(skippedClosing, "reading");
  assert.equal(offersNext(skippedClosing), false);
});

test("a wrong closing answer records completion, so reopening shows the lesson complete", () => {
  const reopened = startStage([done, wrong], true);
  assert.equal(reopened, "done");
  assert.equal(offersNext(reopened), true);
});

test("without a completion row the stage never reaches done, whatever the step states", () => {
  for (const states of [[open, open], [done, open], [done, wrong], [done, done], [open, done]])
    assert.notEqual(startStage(states, false), "done");
});

test("the flow advances opening, reading, closing, done and offers next only at the end", () => {
  assert.equal(advance("opening"), "reading");
  assert.equal(advance("reading"), "reading");
  assert.equal(advance("closing"), "done");
  assert.deepEqual((["opening", "reading", "closing", "done"] as const).map(offersNext), [false, false, false, true]);
});

test("only learn and watch lessons with two checks use the flow", () => {
  assert.equal(hasChecks("learn", [open, open]), true);
  assert.equal(hasChecks("watch", [open, open]), true);
  assert.equal(hasChecks("learn", []), false);
  assert.equal(hasChecks("predict", [open, open]), false);
});
