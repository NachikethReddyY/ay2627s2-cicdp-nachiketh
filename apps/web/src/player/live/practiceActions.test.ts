import { test } from "node:test";
import assert from "node:assert/strict";
import { practiceActions } from "./practiceActions.ts";

test("Run uses the shell when the sandbox is on, and the one-shot path without a lessonId when it is off", () => {
  assert.deepEqual(practiceActions({ language: "python", code: "c", lessonId: "prac-1", sandboxEnabled: true }).run, { via: "shell" });
  const off = practiceActions({ language: "javascript", code: "c", lessonId: "prac-1", sandboxEnabled: false }).run;
  assert.deepEqual(off, { via: "oneshot", args: ["c", "javascript"] });
  assert.equal((off as { args: unknown[] }).args.length, 2, "no lessonId slot at all");
});

test("Check always uses the one-shot path with the lessonId", () => {
  for (const sandboxEnabled of [true, false])
    assert.deepEqual(practiceActions({ language: "python", code: "c", lessonId: "prac-1", sandboxEnabled }).check,
      { via: "oneshot", args: ["c", "python", "prac-1"] });
});
