import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKS, parseSpec } from "../src/index.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/stage/${n}.json`, import.meta.url), "utf8");
const mod = BLOCKS.find((m) => m.type === "stage")!;

test("valid stages parse cleanly", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  assert.deepEqual(r.issues, []);
  assert.equal(r.spec.blocks.length, 2);
});

test("valid physics stage parses without changing the v1 envelope", () => {
  const r = parseSpec(load("valid-bounce"));
  assert.ok(r.ok);
  assert.deepEqual(r.issues, []);
  assert.match(mod.describe(r.spec.blocks[1]!), /keeping about 56% of its energy/);
});

// Each negative fixture is [text block, bad stage]; the stage is dropped and the text kept.
for (const [name, path, msg] of [
  ["too-many-shapes", "blocks.1.props.shapes", /60|at most|too big/i],
  ["coord-101", "blocks.1.props.shapes.0.x", /100|too big|at most/i],
  ["rect-overflow", "blocks.1.props.shapes.0.x", /leaves the 0-100 canvas/],
  ["unknown-kind", "blocks.1.props.shapes.0.kind", /./],
  ["unknown-id", "blocks.1.props.timeline.steps.1.set.0.id", /unknown shape/],
  ["bad-prop", "blocks.1.props.timeline.steps.1.set.0.prop", /cannot be animated/],
  ["opacity-2", "blocks.1.props.timeline.steps.1.set.2.value", /between 0 and 1/],
  ["no-alt", "blocks.1.props.alt", /./],
  ["bad-color", "blocks.1.props.shapes.0.fill", /./],
  ["bounce-not-circle", "blocks.1.props.physics.body", /must be a circle/],
  ["bounce-below-floor", "blocks.1.props.physics.floor", /at least 5 above/],
  ["bounce-with-timeline", "blocks.1.props.physics", /use either timeline or physics/],
  ["bounce-restitution", "blocks.1.props.physics.restitution", /./],
] as const) {
  test(`stage/${name} drops the bad block`, () => {
    const r = parseSpec(load(name));
    assert.ok(r.ok);
    assert.equal(r.spec.blocks.length, 1);
    assert.equal(r.issues[0].path, path);
    assert.match(r.issues[0].message, msg);
  });
}

test("check rejects missing geometry, wrong-type values and duplicate ids", () => {
  const stage = (shapes: unknown[], timeline?: unknown) => ({ v: 1, blocks: [{ type: "stage", id: "s", props: { alt: "a", shapes, timeline } }] });
  const bad = (spec: unknown) => parseSpec(spec).issues.map((i) => i.message).join("|");
  assert.match(bad(stage([{ id: "a", kind: "circle", x: 1, y: 1 }])), /circle shapes need r/);
  assert.match(bad(stage([{ id: "a", kind: "circle", x: 1, y: 1, r: 1, w: 2 }])), /not used/);
  assert.match(bad(stage([{ id: "a", kind: "text", x: 1, y: 1 }])), /need label/);
  assert.match(bad(stage([{ id: "a", kind: "circle", x: 1, y: 1, r: 1 }, { id: "a", kind: "circle", x: 1, y: 1, r: 1 }])), /duplicate/);
  const t = (prop: string, value: unknown) => ({ steps: [{ caption: "c", durationMs: 500, set: [{ id: "a", prop, value }] }] });
  const c = [{ id: "a", kind: "circle", x: 1, y: 1, r: 1 }];
  assert.match(bad(stage(c, t("fill", "red"))), /theme colour/);
  assert.match(bad(stage(c, t("x", "5"))), /must be a number/);
  assert.match(bad(stage(c, t("x", 101))), /between 0 and 100/);
  assert.ok(parseSpec(stage(c, t("opacity", 0.5))).ok);
});

test("check keeps whole shapes inside the canvas", () => {
  const stage = (shape: object) => ({ v: 1, blocks: [{ type: "stage", id: "s", props: { alt: "a", shapes: [{ id: "a", ...shape }] } }] });
  const paths = (shape: object) => parseSpec(stage(shape)).issues.map((i) => i.path);
  assert.deepEqual(paths({ kind: "rect", x: 90, y: 0, w: 50, h: 5 }), ["blocks.0.props.shapes.0.x"]);
  assert.deepEqual(paths({ kind: "circle", x: 50, y: 5, r: 20 }), ["blocks.0.props.shapes.0.y"]);
  assert.deepEqual(paths({ kind: "line", x: 10, y: 10, x2: 20, y2: 101 }).length, 1);
  assert.deepEqual(paths({ kind: "line", x: 10, y: 10, x2: 20, y2: 95 }), []);
  assert.deepEqual(paths({ kind: "ellipse", x: 95, y: 50, w: 20, h: 10 }), ["blocks.0.props.shapes.0.x"]);
  assert.deepEqual(paths({ kind: "rect", x: 50, y: 80, w: 50, h: 20 }), []);
});

test("describe lists shapes and the step captions", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  const d = mod.describe(r.spec.blocks[1]);
  assert.match(d, /Ball \(circle\)/);
  assert.match(d, /Over 2 steps: 1\. Start on the left 2\. Roll to the right/);
});

test("prompt example is itself a valid block", () => {
  const ex = mod.prompt.match(/Example: (\{.*\})/)![1];
  assert.ok(parseSpec({ v: 1, blocks: [JSON.parse(ex)] }).ok);
});
