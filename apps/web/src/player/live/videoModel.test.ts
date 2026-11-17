import assert from "node:assert/strict";
import test from "node:test";
import { chapterMarks, currentChapter, explainPrompt, formatTime, skipTime, SPEEDS, nextSpeed } from "./videoModel.ts";

test("time shows minutes and zero-padded seconds", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65), "1:05");
  assert.equal(formatTime(600.9), "10:00");
});

test("an unknown or negative time shows 0:00", () => {
  assert.equal(formatTime(Number.NaN), "0:00");
  assert.equal(formatTime(Number.POSITIVE_INFINITY), "0:00");
  assert.equal(formatTime(-5), "0:00");
});

test("skipping stays inside the video", () => {
  assert.equal(skipTime(10, 5, 60), 15);
  assert.equal(skipTime(2, -5, 60), 0);
  assert.equal(skipTime(58, 5, 60), 60);
});

test("skipping with no known length still never goes below zero", () => {
  assert.equal(skipTime(3, -10, Number.NaN), 0);
  assert.equal(skipTime(3, 10, Number.NaN), 13);
});

test("speed steps through the list and wraps to the first", () => {
  assert.deepEqual(SPEEDS, [1, 1.25, 1.5, 0.75]);
  assert.equal(nextSpeed(1), 1.25);
  assert.equal(nextSpeed(0.75), 1);
  assert.equal(nextSpeed(3), 1); // an unlisted speed restarts the cycle
});

const chapters = [{ start: 0, title: "Intro" }, { start: 30, title: "Two cups" }, { start: 90, title: "Counting" }];

test("markers sit at each chapter's share of the length, and skip the very start", () => {
  assert.deepEqual(chapterMarks(chapters, 120), [{ left: 25, title: "Two cups" }, { left: 75, title: "Counting" }]);
});

test("a chapter past the end, or an unknown length, gives no marker", () => {
  assert.deepEqual(chapterMarks(chapters, 60), [{ left: 50, title: "Two cups" }]);
  assert.deepEqual(chapterMarks(chapters, Number.NaN), []);
  assert.deepEqual(chapterMarks(chapters, 0), []);
});

test("the current chapter is the last one that has started", () => {
  assert.equal(currentChapter(chapters, 0), "Intro");
  assert.equal(currentChapter(chapters, 45), "Two cups");
  assert.equal(currentChapter(chapters, 999), "Counting");
  assert.equal(currentChapter([], 10), null);
});

test("Explain quotes the caption on screen", () => {
  assert.equal(explainPrompt("  A variable is a labelled box.  ", 12), 'Explain this part of the lesson video: "A variable is a labelled box."');
});

test("Explain falls back to the time when no caption is showing", () => {
  assert.equal(explainPrompt("", 65), "Explain what the lesson video covers at 1:05.");
});

test("a very long caption is cut so the question stays short", () => {
  const out = explainPrompt("x".repeat(500), 1);
  assert.ok(out.length < 360);
  assert.ok(out.endsWith('…"'));
});
