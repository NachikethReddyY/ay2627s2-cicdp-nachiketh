import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKS, parseSpec } from "../src/index.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/diagram/${n}.json`, import.meta.url), "utf8");
const mod = BLOCKS.find((m) => m.type === "diagram")!;

test("valid flow, tree and cycle diagrams parse cleanly", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.spec.blocks.map((b: any) => b.props.kind), ["flow", "tree", "cycle"]);
});

for (const [name, path, msg] of [
  ["too-many-nodes", "blocks.1.props.nodes", /31|at most|too big/i],
  ["too-many-edges", "blocks.1.props.edges", /51|at most|too big/i],
  ["unknown-endpoint", "blocks.1.props.edges.0.to", /unknown node/],
  ["duplicate-node", "blocks.1.props.nodes.1.id", /duplicate/],
  ["label-over-cap", "blocks.1.props.nodes.0.label", /60|too big|at most/i],
  ["bad-shape", "blocks.1.props.shape", /./],
  ["no-alt", "blocks.1.props.alt", /./],
] as const) {
  test(`diagram/${name} drops the bad block`, () => {
    const r = parseSpec(load(name));
    assert.ok(r.ok);
    assert.equal(r.spec.blocks.length, 1);
    assert.equal(r.issues[0].path, path);
    assert.match(r.issues[0].message, msg);
  });
}

test("describe lists nodes and edges", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  const d = mod.describe(r.spec.blocks[0]);
  assert.match(d, /Nodes: Add, Check/);
  assert.match(d, /Edges: Add -> Check \(then\)/);
});

test("prompt example is itself a valid block", () => {
  const ex = mod.prompt.match(/Example: (\{.*\})/)![1];
  assert.ok(parseSpec({ v: 1, blocks: [JSON.parse(ex)] }).ok);
});

const withTimeline = (sets: unknown[][]) => ({
  v: 1,
  blocks: [{ type: "diagram", id: "d", props: { kind: "flow", alt: "a", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }],
    timeline: { steps: sets.map((set, i) => ({ caption: `Step ${i}`, durationMs: 1000, set })) } } }],
});
const issues = (spec: unknown) => parseSpec(spec).issues.map((i) => `${i.path}: ${i.message}`).join("|");

test("diagram timeline: valid fixture parses and describe lists the steps", () => {
  const r = parseSpec(load("valid-timeline"));
  assert.ok(r.ok);
  assert.deepEqual(r.issues, []);
  assert.match(mod.describe(r.spec.blocks[0]), /Over 2 steps: 1\. Start 2\. Add is active/);
});

test("diagram timeline: accepts active booleans on node ids", () => {
  assert.deepEqual(parseSpec(withTimeline([[{ id: "a", prop: "active", value: true }], [{ id: "b", prop: "active", value: false }]])).issues, []);
});

test("diagram timeline: rejects unknown node, other props, non-boolean values", () => {
  assert.match(issues(withTimeline([[{ id: "zz", prop: "active", value: true }]])), /props\.timeline\.steps\.0\.set\.0\.id: unknown node "zz"/);
  assert.match(issues(withTimeline([[{ id: "a", prop: "color", value: true }]])), /props\.timeline\.steps\.0\.set\.0\.prop: .*cannot be set/);
  assert.match(issues(withTimeline([[{ id: "a", prop: "active", value: 1 }]])), /props\.timeline\.steps\.0\.set\.0\.value: active must be true or false/);
});

test("diagram timeline: more than 30 steps is rejected", () => {
  assert.match(issues(withTimeline(Array.from({ length: 31 }, () => []))), /timeline\.steps/);
});

test("diagram/bad-timeline-prop drops the bad block", () => {
  const r = parseSpec(load("bad-timeline-prop"));
  assert.ok(r.ok);
  assert.equal(r.spec.blocks.length, 1);
  assert.equal(r.issues[0].path, "blocks.1.props.timeline.steps.1.set.0.prop");
});
