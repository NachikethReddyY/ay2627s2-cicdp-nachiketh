import { test } from "node:test";
import assert from "node:assert/strict";
import { canExpand } from "./canExpand.ts";

test("safe names within four segments can expand", () => {
  assert.equal(canExpand("", "src"), true);
  assert.equal(canExpand("a/b/c", "d.e-f_1"), true);
});

test("names the API rejects cannot expand", () => {
  for (const name of ["my dir", "naïve", "a:b", "..", ".", "x".repeat(65)]) assert.equal(canExpand("", name), false, name);
});

test("a path deeper than four segments cannot expand", () => {
  assert.equal(canExpand("a/b/c", "d"), true);
  assert.equal(canExpand("a/b/c/d", "e"), false);
});

test("a parent path the API would reject cannot expand its children", () => {
  assert.equal(canExpand("bad name", "x"), false);
});
