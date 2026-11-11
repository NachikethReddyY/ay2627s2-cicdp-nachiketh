import { test } from "node:test";
import assert from "node:assert/strict";
import { courseProgress, lessonTitle } from "./courseProgress.ts";

test("counts only lessons whose parts are all done", () => {
  const lessons = [
    { done: 1, total: 1 },
    { done: 0, total: 2 },
    { done: 2, total: 2 },
    { done: 0, total: 0 },
  ];
  assert.deepEqual(courseProgress(lessons), { done: 2, total: 4 });
});

test("a course nobody has started has nothing done", () => {
  assert.deepEqual(courseProgress([{ done: 0, total: 1 }, { done: 0, total: 1 }]), { done: 0, total: 2 });
});

test("names the lesson being loaded, and nothing when it is not in the course", () => {
  const lessons = [
    { slug: "a", title: "Variables" },
    { slug: "b", title: "Loops" },
  ];
  assert.equal(lessonTitle(lessons, "b"), "Loops");
  assert.equal(lessonTitle(lessons, "missing"), undefined);
});
