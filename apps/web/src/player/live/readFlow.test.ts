import { test } from "node:test";
import assert from "node:assert/strict";
import { hasChecks, startStage } from "./readFlow.ts";

const open = { state: "predicting" as const };
const done = { state: "revealed" as const };

test("a learn or watch lesson starts with its opening prediction", () => {
  assert.equal(startStage([open, open]), "opening");
});

test("an answered opening resumes at reading, and the closing check is never skipped past", () => {
  assert.equal(startStage([done, open]), "reading");
  assert.equal(startStage([{ state: "skipped" }, { state: "hinting" }]), "reading");
});

test("a lesson is done only once its closing check is answered", () => {
  assert.equal(startStage([done, done]), "done");
  assert.equal(startStage([open, done]), "done");
});

test("only learn and watch lessons with two checks use the flow", () => {
  assert.equal(hasChecks("learn", [open, open]), true);
  assert.equal(hasChecks("watch", [open, open]), true);
  assert.equal(hasChecks("learn", []), false);
  assert.equal(hasChecks("predict", [open, open]), false);
});
