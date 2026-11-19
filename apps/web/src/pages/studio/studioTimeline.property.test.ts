import { test } from "node:test";
import assert from "node:assert/strict";
import { seek } from "@learnquest/player-core";
import { editHunk, editTimeline, STUDIO_FILE } from "./studioTimeline.ts";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LINES = ["", "x = 1", "words = []", "words.append(\"apple\")", "print(len(words))", "    pass", "def f():"];

function randomFile(rand: () => number): string {
  return Array.from({ length: Math.floor(rand() * 6) }, () => LINES[Math.floor(rand() * LINES.length)]).join("\n");
}

test("replaying an edit always ends on exactly the new code", () => {
  const rand = mulberry32(5);
  for (let run = 0; run < 3000; run++) {
    const before = randomFile(rand);
    const after = rand() < 0.5 ? `${before}\n${randomFile(rand)}` : randomFile(rand);
    const timeline = editTimeline(before, after);
    assert.equal(seek(timeline, timeline.duration).files[STUDIO_FILE], after, `run ${run}: ${JSON.stringify({ before, after })}`);
    assert.equal(seek(timeline, 0).files[STUDIO_FILE], before, `run ${run} did not start from the old code`);
  }
});

test("an appended line is one hunk that only adds, after the unchanged lines", () => {
  assert.deepEqual(editHunk("words = []", "words = []\nwords.append(1)"), [
    { id: "studio-edit", file: STUDIO_FILE, oldStart: 2, lines: ["+words.append(1)"] },
  ]);
});

test("the same code needs no hunk", () => {
  assert.deepEqual(editHunk("a\nb", "a\nb"), []);
});
