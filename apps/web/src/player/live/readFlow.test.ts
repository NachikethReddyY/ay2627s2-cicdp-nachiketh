import { test } from "node:test";
import assert from "node:assert/strict";
import { advance, hasChecks, offersNext, outcomeCopy, stageFor, startStage } from "./readFlow.ts";

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

test("the closing page stays up while the learner is on it, even after the server reports completion", () => {
  assert.equal(stageFor([done, wrong], true, "on", false), "closing");
  assert.equal(stageFor([done, open], false, "on", true), "closing");
});

test("after Continue, a stale lesson cannot expose the reading stage while the refresh is in flight", () => {
  assert.equal(stageFor([done, open], false, "leaving", true), "closing");
  assert.equal(stageFor([done, wrong], false, "leaving", true), "closing");
});

test("after Continue, a refresh that reports completion wins and offers next", () => {
  assert.equal(stageFor([done, done], true, "leaving", false), "done");
  assert.equal(stageFor([done, done], true, "leaving", true), "done");
});

test("with no closing check in progress the stage is the served stage", () => {
  assert.equal(stageFor([open, open], false, "off", false), "opening");
  assert.equal(stageFor([done, open], false, "off", true), "reading");
  assert.equal(stageFor([done, done], true, "off", false), "done");
  assert.equal(stageFor([open, open], false, "on", false), "opening");
});

test("a checked lesson outcome never shows an answer and points to the video", () => {
  for (const correct of [true, false, null]) {
    const { heading, note } = outcomeCopy(correct);
    assert.match(note, /Watch the lesson/);
    assert.doesNotMatch(`${heading} ${note}`, /here's the answer|answer:/i);
  }
  assert.equal(outcomeCopy(true).heading, "Correct!");
  assert.equal(outcomeCopy(false).heading, "Not quite.");
  assert.equal(outcomeCopy(null).heading, "Check complete.");
});
