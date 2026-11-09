import test from "node:test";
import assert from "node:assert/strict";
import { setupFor } from "./dragSetup.ts";

test("order lays the shuffled items out in position order and submits the arrangement", () => {
  const s = setupFor({ kind: "order", items: ["c", "a", "b"] });
  assert.deepEqual(s.zones.map((z) => z.label), ["Position 1", "Position 2", "Position 3"]);
  assert.deepEqual(s.start, { i0: "z0", i1: "z1", i2: "z2" });
  assert.equal(s.capacity, 1);
  assert.deepEqual(s.submit(s.start), { kind: "order", order: ["c", "a", "b"] });
  // Swapping two items changes what is submitted, so the server sees the learner's order.
  assert.deepEqual(s.submit({ i0: "z1", i1: "z0", i2: "z2" }), { kind: "order", order: ["a", "c", "b"] });
});

test("match submits each left with the right item placed on it", () => {
  const s = setupFor({ kind: "match", lefts: ["dog", "cat"], rights: ["meows", "barks"] });
  assert.ok(s.items.every((it) => s.start[it.id] === null), "all rights start in the pool");
  assert.deepEqual(s.zones.map((z) => z.label), ["dog", "cat"]);
  assert.deepEqual(s.submit({ r0: "l1", r1: "l0" }), { kind: "match", pairs: [{ left: "dog", right: "barks" }, { left: "cat", right: "meows" }] });
});

test("sort submits a bucket index per card and allows many per bucket", () => {
  const s = setupFor({ kind: "sort", buckets: ["Plants", "Animals"], cards: ["fox", "oak", "fern"] });
  assert.equal(s.capacity, Infinity);
  assert.deepEqual(s.submit({ c0: "b1", c1: "b0", c2: "b0" }), {
    kind: "sort",
    cards: [{ text: "fox", bucket: 1 }, { text: "oak", bucket: 0 }, { text: "fern", bucket: 0 }],
  });
});
