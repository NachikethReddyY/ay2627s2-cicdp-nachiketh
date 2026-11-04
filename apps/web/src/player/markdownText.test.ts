import assert from "node:assert/strict";
import test from "node:test";
import { keepLineBreaks } from "./markdownText.ts";

test("single line breaks between prose lines become paragraph breaks", () => {
  assert.equal(keepLineBreaks("First line.\nSecond line."), "First line.\n\nSecond line.");
});

test("blank-line paragraph breaks are unchanged", () => {
  assert.equal(keepLineBreaks("One.\n\nTwo."), "One.\n\nTwo.");
});

test("list items keep their own lines", () => {
  assert.equal(keepLineBreaks("- one\n- two"), "- one  \n- two");
});

test("fenced code blocks are not touched", () => {
  const md = "Intro\n```python\nprint(1)\nprint(2)\n```\nAfter";
  assert.equal(keepLineBreaks(md), md);
});
