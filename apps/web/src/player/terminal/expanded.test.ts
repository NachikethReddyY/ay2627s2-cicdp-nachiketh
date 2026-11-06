import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleExpanded } from "./expanded.ts";

test("folders start collapsed, including names that exist on Object.prototype", () => {
  const open = new Set<string>();
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.equal(open.has(name), false);
});

test("toggleExpanded opens, closes and does not mutate its input", () => {
  const a = new Set<string>();
  const b = toggleExpanded(a, "__proto__");
  assert.equal(a.size, 0);
  assert.equal(b.has("__proto__"), true);
  assert.equal(b.has("constructor"), false);
  const c = toggleExpanded(b, "__proto__");
  assert.equal(c.has("__proto__"), false);
});
