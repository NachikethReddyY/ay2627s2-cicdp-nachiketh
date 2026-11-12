import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStoredPreviewWindow } from "./previewMemory.ts";

test("a stored box and full-screen flag round-trip", () => {
  const stored = parseStoredPreviewWindow(JSON.stringify({ rect: { left: 10, top: 20, width: 640, height: 400 }, maximized: true }));
  assert.deepEqual(stored, { rect: { left: 10, top: 20, width: 640, height: 400 }, maximized: true });
});

test("missing or empty storage gives the default", () => {
  assert.deepEqual(parseStoredPreviewWindow(null), { rect: null, maximized: false });
  assert.deepEqual(parseStoredPreviewWindow(""), { rect: null, maximized: false });
});

test("malformed JSON gives the default instead of throwing", () => {
  assert.deepEqual(parseStoredPreviewWindow("{not json"), { rect: null, maximized: false });
  assert.deepEqual(parseStoredPreviewWindow("42"), { rect: null, maximized: false });
});

test("a box with a non-numeric field is dropped, the flag is kept", () => {
  const stored = parseStoredPreviewWindow(JSON.stringify({ rect: { left: "10", top: 20, width: 640, height: 400 }, maximized: true }));
  assert.deepEqual(stored, { rect: null, maximized: true });
});
