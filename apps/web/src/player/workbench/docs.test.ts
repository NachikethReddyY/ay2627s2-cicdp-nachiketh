import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCS, docForWord, searchDocs } from "./docs.ts";

test("searching loop finds for and while", () => {
  const ids = searchDocs("loop").map((d) => d.id);
  assert.ok(ids.includes("for"));
  assert.ok(ids.includes("while"));
});

test("an empty or blank search gives nothing", () => {
  assert.deepEqual(searchDocs(""), []);
  assert.deepEqual(searchDocs("   "), []);
});

test("search is case-insensitive and reads title, tags and snippet", () => {
  assert.ok(searchDocs("ARRAY").some((d) => d.id === "push"));
  assert.ok(searchDocs("append").some((d) => d.id === "push"));
  assert.ok(searchDocs("return a value").some((d) => d.id === "fn"));
});

test("every see-also id exists and ids are unique", () => {
  const ids = new Set(DOCS.map((d) => d.id));
  assert.equal(ids.size, DOCS.length);
  for (const d of DOCS) for (const s of d.see) assert.ok(ids.has(s), `${d.id} -> ${s}`);
});

test("docForWord finds a doc by identifier and language", () => {
  assert.equal(docForWord("push", "javascript")?.id, "push");
  assert.equal(docForWord("push", "typescript")?.id, "push");
  assert.equal(docForWord("print", "javascript"), undefined);
  assert.equal(docForWord("print", "python")?.id, "print");
});

test("a word shared by languages resolves to that language's entry", () => {
  assert.equal(docForWord("for", "javascript")?.src, "JavaScript docs");
  assert.equal(docForWord("for", "python")?.src, "Python docs");
});

test("the catalogue is a plain reference: no lesson answer", () => {
  for (const d of DOCS) assert.doesNotMatch(d.example, /\b(sum|total)\b/i, d.id);
});
