import assert from "node:assert/strict";
import test from "node:test";
import { TEST_DOCS, TEST_LESSONS, pickTestLesson } from "./testEditorFixture.ts";

test("pickTestLesson returns the lesson for a known language", () => {
  assert.equal(pickTestLesson("python").fileName, "sum.py");
  assert.equal(pickTestLesson("typescript").fileName, "sum.ts");
});

test("pickTestLesson falls back to JavaScript for missing or odd values", () => {
  for (const v of [undefined, "", "rust", "toString", "__proto__", 3]) {
    assert.equal(pickTestLesson(v).language, "javascript");
  }
});

test("every lesson's file list starts with its own code file", () => {
  for (const l of Object.values(TEST_LESSONS)) assert.equal(l.files[0]?.path, l.fileName);
});

test("every doc's see-also points at a doc that exists", () => {
  const ids = new Set(TEST_DOCS.map((d) => d.id));
  for (const d of TEST_DOCS) for (const s of d.see) assert.ok(ids.has(s), `${d.id} -> ${s}`);
});
