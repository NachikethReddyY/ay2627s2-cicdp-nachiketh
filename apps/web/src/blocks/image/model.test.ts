import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveImage } from "./model.ts";

test("a valid id loads", () => {
  assert.deepEqual(resolveImage("ast_pizza", null), { kind: "load", src: "/media/assets/ast_pizza" });
});

test("a failed id falls back, a new assetId resets the failed state", () => {
  assert.equal(resolveImage("a1", "a1").kind, "fallback");
  assert.equal(resolveImage("a2", "a1").kind, "load");
});

test("empty or invalid ids go to the fallback", () => {
  for (const id of ["", "a/b", "../x", "a b", "x".repeat(65)]) assert.equal(resolveImage(id, null).kind, "fallback");
});
