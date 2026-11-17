import assert from "node:assert/strict";
import test from "node:test";
import { testEditorLesson } from "./testEditorLesson.ts";

const lessonOf = (value: unknown) => value as Parameters<typeof testEditorLesson>[0];

test("a practice lesson gives its instructions and language", () => {
  const part = { kind: "practice", instructions: "Add two numbers.", language: "python" };
  assert.deepEqual(testEditorLesson(lessonOf({ part })), { instructions: "Add two numbers.", language: "python" });
});

test("a part that is not practice is an error", () => {
  const result = testEditorLesson(lessonOf({ part: { kind: "learn" } }));
  assert.ok("error" in result);
  assert.match(result.error, /learn/);
});

test("a null part or a missing lesson is an error", () => {
  assert.ok("error" in testEditorLesson(lessonOf({ part: null })));
  assert.ok("error" in testEditorLesson(null));
});

test("an unknown or missing language falls back to javascript", () => {
  for (const language of ["rust", "toString", "", undefined]) {
    const result = testEditorLesson(lessonOf({ part: { kind: "practice", instructions: "x", language } }));
    assert.deepEqual(result, { instructions: "x", language: "javascript" });
  }
});
