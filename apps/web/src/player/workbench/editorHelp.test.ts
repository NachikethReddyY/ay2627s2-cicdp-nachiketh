import assert from "node:assert/strict";
import { test } from "node:test";
import { explainMarker, hoverWord } from "./editorHelp.ts";

test("Cannot find name tells the learner to create the name first", () => {
  const s = explainMarker("Cannot find name 'step'.");
  assert.ok(s);
  assert.match(s, /step/);
  assert.match(s, /create|declare|define/i);
  assert.match(s, /before/i);
});

test("a missing name does not suggest code to paste", () => {
  assert.doesNotMatch(explainMarker("Cannot find name 'x'.") ?? "", /`|let x|const x/);
});

test("syntax errors get a sentence about brackets, quotes or typos", () => {
  assert.match(explainMarker("';' expected.") ?? "", /missing|typo|punctuation/i);
  assert.match(explainMarker("')' expected.") ?? "", /bracket|parenthes/i);
  assert.match(explainMarker("Unterminated string literal.") ?? "", /quote/i);
  assert.match(explainMarker("Expression expected.") ?? "", /expression|missing/i);
});

test("an unknown message gives nothing", () => {
  assert.equal(explainMarker("Type 'string' is not assignable to type 'number'."), undefined);
  assert.equal(explainMarker(""), undefined);
});

test("hoverWord maps console.log's log to console, and leaves other receivers alone", () => {
  assert.equal(hoverWord("log", "  console."), "console");
  assert.equal(hoverWord("log", "x = Math."), "log");
  assert.equal(hoverWord("push", "arr."), "push");
});
