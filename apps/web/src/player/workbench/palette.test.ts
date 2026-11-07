import { test } from "node:test";
import assert from "node:assert/strict";
import { filterItems, paletteKey, parseQuery, type PaletteItem } from "./palette.ts";

test("parseQuery: leading > is commands", () => {
  assert.deepEqual(parseQuery(">toggle"), { mode: "cmd", term: "toggle" });
  assert.deepEqual(parseQuery("> Toggle "), { mode: "cmd", term: "toggle" });
});

test("parseQuery: leading ? is docs", () => {
  assert.deepEqual(parseQuery("? For "), { mode: "doc", term: "for" });
});

test("parseQuery: anything else is files", () => {
  assert.deepEqual(parseQuery("trace"), { mode: "file", term: "trace" });
  assert.deepEqual(parseQuery("  Sum.JS "), { mode: "file", term: "sum.js" });
  assert.deepEqual(parseQuery(""), { mode: "file", term: "" });
  assert.deepEqual(parseQuery("a>b"), { mode: "file", term: "a>b" });
});

const items: PaletteItem[] = [
  { id: "a", title: "for loop", sub: "Repeats a block" },
  { id: "b", title: "Functions", sub: "Named block of code" },
  { id: "c", title: "README.md" },
];

test("filterItems: empty term returns all", () => {
  assert.deepEqual(filterItems(items, ""), items);
});

test("filterItems: case-insensitive on title and sub", () => {
  assert.deepEqual(filterItems(items, "readme").map((i) => i.id), ["c"]);
  assert.deepEqual(filterItems(items, "block").map((i) => i.id), ["a", "b"]);
  assert.deepEqual(filterItems(items, "zzz"), []);
});

test("filterItems: items without sub do not match 'undefined'", () => {
  assert.deepEqual(filterItems(items, "undefined"), []);
});

const key = (k: string, o: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}) =>
  ({ key: k, metaKey: !!o.meta, ctrlKey: !!o.ctrl, shiftKey: !!o.shift });

test("paletteKey: Cmd/Ctrl+P is files, with Shift is commands", () => {
  assert.equal(paletteKey(key("p", { meta: true })), "file");
  assert.equal(paletteKey(key("p", { ctrl: true })), "file");
  assert.equal(paletteKey(key("P", { meta: true, shift: true })), "cmd");
  assert.equal(paletteKey(key("p", { ctrl: true, shift: true })), "cmd");
});

test("paletteKey: other keys are null", () => {
  assert.equal(paletteKey(key("p")), null);
  assert.equal(paletteKey(key("p", { shift: true })), null);
  assert.equal(paletteKey(key("k", { meta: true })), null);
});
