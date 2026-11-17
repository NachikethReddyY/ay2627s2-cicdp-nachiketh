import assert from "node:assert/strict";
import test from "node:test";
import { actionGuards, lessonFile, outputTail, shellLine } from "./lessonWorkbenchModel.ts";

const idle = { busy: false, checkBusy: false, lintBusy: false, code: "let a = 1;" };

test("every action is allowed when nothing is running", () => {
  assert.deepEqual(actionGuards(idle), { run: true, check: true, lint: true });
});

test("a run in progress blocks Run and Check, but not Lint", () => {
  assert.deepEqual(actionGuards({ ...idle, busy: true }), { run: false, check: false, lint: true });
});

test("a Check in progress blocks Run and Check again", () => {
  const g = actionGuards({ ...idle, checkBusy: true });
  assert.equal(g.run, true);
  assert.equal(g.check, false);
});

test("Lint waits for a running lint and needs some code", () => {
  assert.equal(actionGuards({ ...idle, lintBusy: true }).lint, false);
  assert.equal(actionGuards({ ...idle, code: "  \n" }).lint, false);
});

test("a javascript lesson opens solution.js under the lesson title", () => {
  assert.deepEqual(lessonFile("javascript"), { fileName: "solution.js", languageLabel: "JavaScript" });
});

test("typescript and python lessons open their own solution file", () => {
  assert.deepEqual(lessonFile("typescript"), { fileName: "solution.ts", languageLabel: "TypeScript" });
  assert.deepEqual(lessonFile("python"), { fileName: "solution.py", languageLabel: "Python" });
});

test("an unknown language falls back to javascript", () => {
  assert.equal(lessonFile(undefined).fileName, "solution.js");
  assert.equal(lessonFile("rust").fileName, "solution.js");
});

test("output that fits is kept whole", () => {
  assert.equal(outputTail("hello\n", 100), "hello\n");
});

test("long output keeps only its tail, so the pane stays light", () => {
  assert.equal(outputTail("abcdefghij", 4), "ghij");
});

test("a starting shell says the sandbox is starting", () => {
  assert.deepEqual(shellLine({ kind: "connecting" }), { text: "Starting your sandbox…" });
});

test("a shell that is ready or not yet asked for shows no line", () => {
  assert.equal(shellLine({ kind: "idle" }), null);
  assert.equal(shellLine({ kind: "open", ready: true }), null);
});

test("a terminal taken over by another window offers a retry", () => {
  assert.deepEqual(shellLine({ kind: "closed", reason: "replaced", message: "x" }), { text: "The terminal is open in another window", retry: true });
});

test("a server with the sandbox off or a signed-out learner gets no retry", () => {
  assert.deepEqual(shellLine({ kind: "closed", reason: "disabled", message: "x" }), { text: "The sandbox is off on this server" });
  assert.deepEqual(shellLine({ kind: "closed", reason: "signed_out", message: "x" }), { text: "Sign in to use the terminal" });
});

test("any other close shows the server's message with a retry", () => {
  assert.deepEqual(shellLine({ kind: "closed", reason: "busy", message: "All sandboxes are busy" }), { text: "All sandboxes are busy", retry: true });
});

test("a reconnecting shell says so, and an exited shell tells the learner how to restart it", () => {
  assert.deepEqual(shellLine({ kind: "reconnecting", attempt: 1, inMs: 1000 }), { text: "Reconnecting…" });
  assert.deepEqual(shellLine({ kind: "exited", code: 0 }), { text: "[shell ended] Press Enter to start a new one" });
});
