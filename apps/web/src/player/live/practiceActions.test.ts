import { test } from "node:test";
import assert from "node:assert/strict";
import { practiceActions, shouldFallBack, skipShellWait } from "./practiceActions.ts";

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

test("shouldFallBack: disabled always; starting/unavailable only when the socket is failing", () => {
  assert.equal(shouldFallBack("disabled", { kind: "connecting" }), true);
  for (const kind of ["starting", "unavailable"] as const) {
    assert.equal(shouldFallBack(kind, { kind: "reconnecting" }), true);
    assert.equal(shouldFallBack(kind, { kind: "closed" }), true);
    assert.equal(shouldFallBack(kind, { kind: "connecting" }), false);
    assert.equal(shouldFallBack(kind, { kind: "open" }), false);
  }
  assert.equal(shouldFallBack("copy", { kind: "closed" }), false);
});

test("shouldFallBack: a second readiness timeout in a row while connecting falls back; the first keeps the note", () => {
  assert.equal(shouldFallBack("starting", { kind: "connecting" }, 1), false);
  assert.equal(shouldFallBack("starting", { kind: "connecting" }, 2), true);
  assert.equal(shouldFallBack("starting", { kind: "connecting" }, 3), true);
  assert.equal(shouldFallBack("starting", { kind: "open" }, 2), false, "an open shell is a slow start, not unreachable");
  assert.equal(shouldFallBack("unavailable", { kind: "connecting" }, 2), false);
  assert.equal(shouldFallBack("copy", { kind: "connecting" }, 2), false);
});

test("skipShellWait: reconnecting or closed skip the wait; replaced, exited and a cold start keep it", () => {
  assert.equal(skipShellWait(false, { kind: "reconnecting" }), true);
  assert.equal(skipShellWait(false, { kind: "closed", reason: "busy" }), true);
  assert.equal(skipShellWait(false, { kind: "closed", reason: "replaced" }), false);
  assert.equal(skipShellWait(false, { kind: "exited" }), false);
  assert.equal(skipShellWait(false, { kind: "connecting" }), false);
  assert.equal(skipShellWait(false, { kind: "open", ready: false }), false);
  assert.equal(skipShellWait(false, { kind: "open", ready: true }), false);
});

test("skipShellWait: after a fallback the shell stays skipped until it is open and ready again", () => {
  assert.equal(skipShellWait(true, { kind: "connecting" }), true);
  assert.equal(skipShellWait(true, { kind: "open", ready: false }), true);
  assert.equal(skipShellWait(true, { kind: "paused" }), true);
  assert.equal(skipShellWait(true, { kind: "open", ready: true }), false);
  assert.equal(skipShellWait(true, { kind: "exited" }), false);
  assert.equal(skipShellWait(true, { kind: "closed", reason: "replaced" }), false);
});
