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
  assert.equal(offersNext([done, open], false), false);
});

test("a skipped step never opens the lesson or offers next", () => {
  assert.equal(startStage([{ state: "skipped" }, open], false), "opening");
  const skippedClosing = [done, { state: "skipped" as const }];
  assert.equal(startStage(skippedClosing, false), "reading");
  assert.equal(offersNext(skippedClosing, false), false);
});

test("a wrong closing answer records completion, so reopening shows the lesson complete", () => {
  const reopened = startStage([done, wrong], true);
  assert.equal(reopened, "done");
  assert.equal(offersNext([done, wrong], true), true);
});

test("without a completion row the stage never reaches done, whatever the step states", () => {
  for (const states of [[open, open], [done, open], [done, wrong], [done, done], [open, done]])
    assert.notEqual(startStage(states, false), "done");
});

test("the flow follows server state, and offers next only once the server reports completion", () => {
  assert.equal(advance([open, open], false), "opening");
  assert.equal(advance([done, open], false), "reading");
  assert.equal(advance([done, done], true), "done");
  assert.deepEqual(
    [[open, open], [done, open], [done, done]].map((c) => offersNext(c, false)),
    [false, false, false],
  );
  assert.equal(offersNext([done, done], true), true);
});

test("a terminal closing step without a completion row never reaches done or offers next", () => {
  for (const closing of [done, wrong, { state: "skipped" as const }]) {
    assert.notEqual(advance([done, closing], false), "done");
    assert.equal(offersNext([done, closing], false), false);
  }
});

test("only learn and watch lessons with two checks use the flow", () => {
  assert.equal(hasChecks("learn", [open, open]), true);
  assert.equal(hasChecks("watch", [open, open]), true);
  assert.equal(hasChecks("learn", []), false);
  assert.equal(hasChecks("predict", [open, open]), false);
});
