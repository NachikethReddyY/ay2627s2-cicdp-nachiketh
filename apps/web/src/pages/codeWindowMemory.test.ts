import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStoredCodeWindow } from "./codeWindowMemory.ts";

test("a stored box round-trips", () => {
  assert.deepEqual(parseStoredCodeWindow(JSON.stringify({ left: 10, top: 20, width: 640, height: 400 })), { left: 10, top: 20, width: 640, height: 400 });
});

test("missing or empty storage gives null", () => {
  assert.equal(parseStoredCodeWindow(null), null);
  assert.equal(parseStoredCodeWindow(""), null);
});

test("malformed JSON gives null instead of throwing", () => {
  assert.equal(parseStoredCodeWindow("{not json"), null);
  assert.equal(parseStoredCodeWindow("null"), null);
});

test("a box with a non-numeric field is dropped", () => {
  assert.equal(parseStoredCodeWindow(JSON.stringify({ left: "10", top: 20, width: 640, height: 400 })), null);
});
