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

test("scrim rejects invalid segments, duplicate gates and invalid labs", () => {
  for (const value of [
    { ...scrim, segments: [] },
    { ...scrim, segments: Array(21).fill(segment) },
    { ...scrim, segments: [{ ...segment, text: " " }] },
    { ...scrim, segments: [{ ...segment, durationMs: 499 }] },
    { ...scrim, segments: [{ ...segment, durationMs: 120001 }] },
    { ...scrim, segments: [{ ...segment, gate: -1 }] },
    { ...scrim, segments: [segment, segment] },
    { ...scrim, segments: [{ ...segment, edit: { code: 1, run: true } }] },
    { ...scrim, lab: { kind: "practice" } },
  ]) assert.equal(parseScrim(value), null);
});
