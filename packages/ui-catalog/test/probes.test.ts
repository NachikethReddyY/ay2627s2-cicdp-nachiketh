import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { parseSpec } from "../src/index.ts";

// Hand-written probes for the playground. Each must parse with no issues, so a
// schema change that breaks a probe shows up here before anyone tries it by hand.
const dir = new URL("../probes/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

test("there are probe files", () => {
  assert.ok(files.length >= 9);
});

for (const f of files) {
  test(`probe ${f} parses with no issues`, () => {
    const r = parseSpec(readFileSync(new URL(f, dir), "utf8"));
    assert.ok(r.ok);
    assert.deepEqual(r.issues, []);
    assert.equal(r.spec.blocks.length, 2);
  });
}
