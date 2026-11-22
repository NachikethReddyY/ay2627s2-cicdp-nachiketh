import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScrim } from "../src/parts/scrim-schema.ts";

const lab = { kind: "practice", instructions: "Print.", starterCode: "", expectedOutput: "42" };
const segment = { text: "Predict the output", durationMs: 500, edit: { code: "print(42)", run: true }, gate: 0 };
const scrim = { kind: "scrim", language: "python", segments: [segment], lab };

test("scrim validates segments and uses the practice lab", () => {
  assert.equal(parseScrim(scrim)?.segments[0]?.gate, 0);
  assert.equal(parseScrim(scrim)?.lab.expectedOutput, "42");
});

test("scrim rejects no segments", () => {
  assert.equal(parseScrim({ ...scrim, segments: [] }), null);
});

test("scrim rejects too many segments", () => {
  assert.equal(parseScrim({ ...scrim, segments: Array(21).fill(segment) }), null);
});

test("scrim rejects blank text", () => {
  assert.equal(parseScrim({ ...scrim, segments: [{ ...segment, text: " " }] }), null);
});

test("scrim rejects short duration", () => {
  assert.equal(parseScrim({ ...scrim, segments: [{ ...segment, durationMs: 499 }] }), null);
});

test("scrim rejects long duration", () => {
  assert.equal(parseScrim({ ...scrim, segments: [{ ...segment, durationMs: 120001 }] }), null);
});

test("scrim rejects negative gate", () => {
  assert.equal(parseScrim({ ...scrim, segments: [{ ...segment, gate: -1 }] }), null);
});

test("scrim rejects duplicate gates", () => {
  assert.equal(parseScrim({ ...scrim, segments: [segment, segment] }), null);
});

test("scrim rejects non-string edit", () => {
  assert.equal(parseScrim({ ...scrim, segments: [{ ...segment, edit: { code: 1, run: true } }] }), null);
});

test("scrim rejects malformed lab", () => {
  assert.equal(parseScrim({ ...scrim, lab: { kind: "practice" } }), null);
});
