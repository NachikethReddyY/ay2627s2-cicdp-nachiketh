import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKS, parseSpec, vec3Value } from "../src/index.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/scene3d/${n}.json`, import.meta.url), "utf8");
const mod = BLOCKS.find((m) => m.type === "scene3d")!;

test("valid scenes parse cleanly", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  assert.deepEqual(r.issues, []);
  assert.equal(r.spec.blocks.length, 2);
});

// Each negative fixture is [text block, bad scene]; the scene is dropped and the text kept.
for (const [name, path, msg] of [
  ["too-many-primitives", "blocks.1.props.primitives", /60|at most|too big/i],
  ["group-in-group", "blocks.1.props.groups.1.children.0", /cannot contain group/],
  ["unknown-prop", "blocks.1.props.timeline.steps.0.set.0.prop", /cannot be animated/],
  ["coord-11", "blocks.1.props.primitives.0.position.0", /10|too big|at most/i],
  ["opacity-2", "blocks.1.props.timeline.steps.0.set.0.value", /between 0 and 1/],
  ["bad-color", "blocks.1.props.primitives.0.color", /./],
  ["no-alt", "blocks.1.props.alt", /./],
  ["unknown-id", "blocks.1.props.timeline.steps.0.set.0.id", /unknown primitive/],
  ["unknown-kind", "blocks.1.props.primitives.0.kind", /./],
] as const) {
  test(`scene3d/${name} drops the bad block`, () => {
    const r = parseSpec(load(name));
    assert.ok(r.ok);
    assert.equal(r.spec.blocks.length, 1);
    assert.equal(r.issues[0].path, path);
    assert.match(r.issues[0].message, msg);
  });
}

test("vec3Value parses only in-range x,y,z strings", () => {
  assert.deepEqual(vec3Value("1, 2,-3", 10), [1, 2, -3]);
  for (const v of ["1,2", "1,2,11", "a,b,c", ",,", 5, null]) assert.equal(vec3Value(v, 10), null);
});

test("describe lists objects, groups, camera and step captions", () => {
  const r = parseSpec(load("valid"));
  assert.ok(r.ok);
  const d = mod.describe(r.spec.blocks[1]);
  assert.match(d, /Nucleus \(sphere\)/);
  assert.match(d, /Groups: Cell\./);
  assert.match(d, /Camera: iso view/);
  assert.match(d, /Over 2 steps: 1\. The whole cell 2\. The nucleus moves aside/);
});

test("budget is two scene3d blocks per spec", () => {
  const b = JSON.parse(load("valid")).blocks[0];
  const r = parseSpec({ v: 1, blocks: [b, { ...b, id: "b2" }, { ...b, id: "b3" }] });
  assert.ok(r.ok);
  assert.equal(r.spec.blocks.length, 2);
  assert.match(r.issues[0].message, /too many/);
});

test("prompt example is itself a valid block", () => {
  const ex = mod.prompt.match(/Example: (\{.*\})/)![1];
  assert.ok(parseSpec({ v: 1, blocks: [JSON.parse(ex)] }).ok);
});
