import { test } from "node:test";
import assert from "node:assert/strict";
import { writeLabel, writeProgress, type WriteState } from "./writeProgress.ts";

const lessons = (...states: WriteState[]) => states.map((writeState) => ({ writeState }));

test("writeProgress counts each lesson in exactly one state", () => {
  const p = writeProgress(lessons("ready", "writing", "failed", "pending", "ready"));
  assert.deepEqual(p, { total: 5, ready: 2, writing: 1, failed: 1, pending: 1 });
  assert.equal(p.ready + p.writing + p.failed + p.pending, p.total);
});

test("a course with every lesson ready has nothing left to write", () => {
  const p = writeProgress(lessons("ready", "ready"));
  assert.equal(p.ready, p.total);
});

test("only ready lessons have no label", () => {
  assert.equal(writeLabel.ready, null);
  assert.equal(writeLabel.writing, "Writing…");
  assert.equal(writeLabel.failed, "Couldn't write");
  assert.equal(writeLabel.pending, "Not written yet");
});
