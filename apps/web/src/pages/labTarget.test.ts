import assert from "node:assert/strict";
import test from "node:test";
import { labTarget } from "./labTarget.ts";

const lessonOf = (part: unknown) => ({ part }) as Parameters<typeof labTarget>[0];

const lab = { kind: "practice", instructions: "Double n.", language: "javascript", starterCode: "x", tests: [] };

test("a practice lesson opens its own part", () => {
  const result = labTarget(lessonOf(lab));
  assert.ok("part" in result);
  assert.equal(result.part, lab);
  assert.equal(result.origin, "practice");
});

test("a scrim opens the lab it ends with", () => {
  const result = labTarget(lessonOf({ kind: "scrim", language: "javascript", segments: [{ text: "t", durationMs: 1000 }], lab }));
  assert.ok("part" in result);
  assert.equal(result.part, lab);
  assert.equal(result.origin, "scrim");
});

test("a lesson without a lab says which kind it is", () => {
  const result = labTarget(lessonOf({ kind: "learn", body: "b" }));
  assert.ok("error" in result);
  assert.match(result.error, /learn/);
});

test("a null part or a missing lesson is an error", () => {
  assert.ok("error" in labTarget(lessonOf(null)));
  assert.ok("error" in labTarget(null));
  assert.ok("error" in labTarget(undefined));
});

test("a lesson with no part still says its kind", () => {
  const result = labTarget({ kind: "predict", part: null });
  assert.ok("error" in result);
  assert.match(result.error, /predict/);
});
