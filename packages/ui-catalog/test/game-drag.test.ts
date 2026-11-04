import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpec, type GameProps } from "../src/index.ts";

const game = (kind: unknown) => ({
  v: 1,
  blocks: [{ type: "game", id: "g", props: { title: "T", goalText: "G", alt: "A", hints: [], shell: {}, kind } }],
});
const issues = (kind: unknown) => parseSpec(game(kind)).issues;
const kindOf = (kind: unknown) => ((parseSpec(game(kind)) as Extract<ReturnType<typeof parseSpec>, { ok: true }>).spec.blocks[0]!.props as GameProps).kind;

test("valid order, match and sort kinds parse cleanly", () => {
  assert.deepEqual(issues({ kind: "order", items: ["one", "two", "three"] }), []);
  assert.deepEqual(issues({ kind: "match", pairs: [{ left: "cat", right: "meows" }, { left: "dog", right: "barks" }] }), []);
  assert.deepEqual(
    issues({ kind: "sort", buckets: ["Plants", "Animals"], cards: [{ text: "oak", bucket: 0 }, { text: "fox", bucket: 1 }] }),
    [],
  );
});

test("order rejects a repeated item", () => {
  const r = issues({ kind: "order", items: ["a", "b", "a"] });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.path, "blocks.0.props.kind.items.2");
  assert.match(r[0]!.message, /appears twice/);
});

test("order needs at least two items", () => {
  assert.ok(issues({ kind: "order", items: ["only"] }).length > 0);
});

test("match rejects a repeated left or right item", () => {
  const dupLeft = issues({ kind: "match", pairs: [{ left: "x", right: "1" }, { left: "x", right: "2" }] });
  assert.equal(dupLeft[0]!.path, "blocks.0.props.kind.pairs.1.left");
  const dupRight = issues({ kind: "match", pairs: [{ left: "x", right: "1" }, { left: "y", right: "1" }] });
  assert.equal(dupRight[0]!.path, "blocks.0.props.kind.pairs.1.right");
});

test("sort rejects a bucket index that does not exist and an empty bucket", () => {
  const badIndex = issues({ kind: "sort", buckets: ["A", "B"], cards: [{ text: "x", bucket: 0 }, { text: "y", bucket: 5 }] });
  assert.ok(badIndex.some((i) => i.path === "blocks.0.props.kind.cards.1.bucket" && /does not exist/.test(i.message)));
  const empty = issues({ kind: "sort", buckets: ["A", "B"], cards: [{ text: "x", bucket: 0 }, { text: "y", bucket: 0 }] });
  assert.ok(empty.some((i) => i.path === "blocks.0.props.kind.buckets.1" && /has no card/.test(i.message)));
});

test("sort rejects a repeated card", () => {
  const r = issues({ kind: "sort", buckets: ["A", "B"], cards: [{ text: "x", bucket: 0 }, { text: "x", bucket: 1 }] });
  assert.equal(r[0]!.path, "blocks.0.props.kind.cards.1.text");
});

test("drag kinds keep their parsed shape", () => {
  const k = kindOf({ kind: "order", items: ["a", "b"] });
  assert.deepEqual(k, { kind: "order", items: ["a", "b"] });
});
