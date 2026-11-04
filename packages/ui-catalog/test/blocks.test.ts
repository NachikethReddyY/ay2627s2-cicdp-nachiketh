import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKS, parseSpec } from "../src/index.ts";

const load = (t: string, n: string) => readFileSync(new URL(`../fixtures/${t}/${n}.json`, import.meta.url), "utf8");
const mod = (t: string) => BLOCKS.find((m) => m.type === t)!;

test("valid text and image fixtures parse cleanly", () => {
  for (const [t, n] of [["text", 1], ["image", 2]] as const) {
    const r = parseSpec(load(t, "valid"));
    assert.ok(r.ok);
    assert.deepEqual(r.issues, []);
    assert.equal(r.spec.blocks.length, n);
  }
});

for (const [t, name, path] of [
  ["text", "html", "blocks.1.props.md"],
  ["text", "over-cap", "blocks.1.props.md"],
  ["image", "no-alt", "blocks.1.props.alt"],
] as const) {
  test(`${t}/${name} drops the bad block`, () => {
    const r = parseSpec(load(t, name));
    assert.ok(r.ok);
    assert.equal(r.spec.blocks.length, 1);
    assert.equal(r.issues[0].path, path);
  });
}

test("image check rejects ids the caller does not know", () => {
  const spec = JSON.parse(load("image", "unknown-asset"));
  const block = spec.blocks[1];
  assert.deepEqual(mod("image").check(block), []);
  assert.deepEqual(mod("image").check(block, ["ast_pizza"]).map((i) => i.path), ["props.assetId"]);
  assert.deepEqual(mod("image").check(spec.blocks[0], ["ast_pizza"]), []);
});

test("alt is sanitised and describe returns the content", () => {
  const r = parseSpec({ v: 1, blocks: [{ type: "image", id: "i", props: { source: "asset", assetId: "a", alt: "Hi​ there" } }] });
  assert.ok(r.ok);
  assert.equal(mod("image").describe(r.spec.blocks[0]), "Image: Hi there");
  assert.equal(mod("text").describe({ type: "text", id: "t", props: { md: "yo" } }), "yo");
});

test("image generate source validates; prompt is only accepted for generate", () => {
  const one = (props: object) => parseSpec({ v: 1, blocks: [{ type: "image", id: "i", props }] });
  const ok = one({ source: "generate", prompt: "a cat", alt: "A cat" });
  assert.ok(ok.ok && ok.issues.length === 0);
  assert.equal(mod("image").describe(ok.ok ? ok.spec.blocks[0] : null as never), "Image: A cat");
  assert.deepEqual(mod("image").check({ type: "image", id: "i", props: { source: "generate", prompt: "x", alt: "y" } }, ["ast_a"]), []);
  for (const bad of [
    { source: "generate", alt: "A cat" },
    { source: "generate", prompt: "", alt: "A cat" },
    { source: "generate", prompt: "x".repeat(401), alt: "A cat" },
    { source: "asset", assetId: "a", prompt: "a cat", alt: "A cat" },
    { source: "generated-pending", prompt: "a cat", alt: "A cat" },
    { source: "generated", alt: "A cat" },
  ]) assert.equal(one(bad).ok, false, JSON.stringify(bad));
  assert.ok(one({ source: "generated-pending", alt: "A cat" }).ok);
  assert.ok(one({ source: "generated", url: "https://x.test/a.png", alt: "A cat" }).ok);
});
