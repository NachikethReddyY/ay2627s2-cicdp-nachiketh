import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKS, parseSpec } from "../src/index.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/chart/${n}.json`, import.meta.url), "utf8");
const mod = BLOCKS.find((m) => m.type === "chart")!;

test("valid bar, line, scatter and function charts parse cleanly", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.spec.blocks.map((b: any) => b.props.kind), ["bar", "line", "scatter", "function"]);
});

for (const [name, path, msg] of [
  ["bad-identifier", "blocks.1.props.expr", /unknown name "foo" \(at position 0\)/],
  ["bad-string", "blocks.1.props.expr", /unexpected """ \(at position 0\)/],
  ["too-many-series", "blocks.1.props.series", /at most|too big/i],
  ["too-many-points", "blocks.1.props.series.0.points", /at most|too big/i],
  ["expr-too-long", "blocks.1.props.expr", /at most|too big/i],
  ["too-many-sliders", "blocks.1.props.sliders", /at most|too big/i],
  ["no-alt", "blocks.1.props.alt", /./],
] as const) {
  test(`chart/${name} drops the bad block`, () => {
    const r = parseSpec(load(name));
    assert.ok(r.ok);
    assert.equal(r.spec.blocks.length, 1);
    assert.equal(r.issues[0].path, path);
    assert.match(r.issues[0].message, msg);
  });
}

test("describe includes axes and a data table", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  const [bar, , , fn] = r.spec.blocks.map((b) => mod.describe(b));
  assert.match(bar, /X axis: Pet\. Y axis: Students\./);
  assert.match(bar, /Data table \(series, Pet, Students\): \(Class A, Dogs, 12\)/);
  assert.match(fn, /Plots y = m \* x \+ c\..*Data table \(x, y\): \(-5, -10\); \(-2.5, -7.5\)/);
});

test("prompt example is itself a valid block", () => {
  const ex = mod.prompt.match(/Example: (\{.*\})/)![1];
  assert.ok(parseSpec({ v: 1, blocks: [JSON.parse(ex)] }).ok);
});
