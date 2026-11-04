import test from "node:test";
import assert from "node:assert/strict";
import { setupFor, rotate } from "./dragSetup.ts";

test("order starts shuffled and the answer key accepts only the right slot", () => {
  const s = setupFor({ kind: "order", items: ["a", "b", "c"] });
  // Every item starts somewhere other than its answer slot.
  for (const it of s.items) assert.equal(s.isRight(it.id, s.start[it.id]!), false, it.label);
  // Placing each item in its answer slot solves the board.
  const answer = { i0: "z0", i1: "z1", i2: "z2" };
  for (const [item, zone] of Object.entries(answer)) assert.equal(s.isRight(item, zone), true);
  assert.equal(s.capacity, 1);
});

test("match pairs each right item only with its left partner", () => {
  const s = setupFor({ kind: "match", pairs: [{ left: "cat", right: "meows" }, { left: "dog", right: "barks" }] });
  assert.equal(s.isRight("r0", "l0"), true);
  assert.equal(s.isRight("r0", "l1"), false);
  assert.ok(s.items.every((it) => s.start[it.id] === null), "all rights start in the pool");
});

test("sort accepts a card only in its own bucket and allows many per bucket", () => {
  const s = setupFor({
    kind: "sort",
    buckets: ["Plants", "Animals"],
    cards: [{ text: "oak", bucket: 0 }, { text: "fox", bucket: 1 }, { text: "fern", bucket: 0 }],
  });
  assert.equal(s.isRight("c0", "b0"), true);
  assert.equal(s.isRight("c1", "b0"), false);
  assert.equal(s.isRight("c2", "b0"), true);
  assert.equal(s.capacity, Infinity);
});

test("rotate moves the first item to the end and leaves short lists alone", () => {
  assert.deepEqual(rotate(["a", "b", "c"]), ["b", "c", "a"]);
  assert.deepEqual(rotate(["a"]), ["a"]);
});
