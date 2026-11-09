import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../runPython.ts";
import { askLabel, findingPointer, lintErrorMessage, lintSummary } from "./lintModel.ts";

test("a 503 reads as busy; other errors keep their message", () => {
  assert.equal(lintErrorMessage(new ApiError("x", 503)), "Lint is busy, try again soon");
  assert.equal(lintErrorMessage(new ApiError("Sign in first", 401)), "Sign in first");
  assert.equal(lintErrorMessage("nope"), "Could not lint the code");
});

test("the Ask Sloppy button names its line and rule, and the pointer carries only rule, line and column", () => {
  assert.equal(askLabel({ line: 4, ruleId: "prefer-const" }), "Ask Sloppy about line 4: prefer-const");
  assert.deepEqual(findingPointer({ ruleId: "prefer-const", line: 4, column: 2, message: "m" } as { ruleId: string; line: number; column: number }), { ruleId: "prefer-const", line: 4, column: 2 });
});

test("the lint summary reads for none, one and many", () => {
  assert.equal(lintSummary(0), "No style issues found.");
  assert.equal(lintSummary(1), "1 issue found.");
  assert.equal(lintSummary(3), "3 issues found.");
});
