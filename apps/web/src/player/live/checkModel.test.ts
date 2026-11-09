import { test } from "node:test";
import assert from "node:assert/strict";
import { bonusRows, previewRows, monacoLanguage, requiredRows, scoreLine, solutionFile, statusLabel, toRows, type CheckResult } from "./checkModel.ts";
import { checkPractice } from "../runPython.ts";

test("statusLabel maps every status", () => {
  assert.equal(statusLabel("pass"), "✓ Passed");
  assert.equal(statusLabel("fail"), "✗ Failed");
  assert.equal(statusLabel("timeout"), "Timed out");
  assert.equal(statusLabel("error"), "Error");
});

test("scoreLine reads X of Y required, bonus points and best", () => {
  assert.equal(
    scoreLine({ required: { passed: 2, total: 3 }, stretch: { passed: 1, total: 2 }, points: 3, maxPoints: 5, best: { points: 4, maxPoints: 5 } }),
    "2 of 3 required passed · 1 bonus points · best 4/5",
  );
  assert.equal(
    scoreLine({ required: { passed: 3, total: 3 }, stretch: { passed: 0, total: 0 }, points: 3, maxPoints: 3, best: { points: 3, maxPoints: 3 } }),
    "3 of 3 required passed · 0 bonus points · best 3/3",
  );
});

test("hidden tests never reach the UI model with stdin, expected or actual output, even when the object has them", () => {
  const results: CheckResult[] = [
    { id: "a", name: "Sample", stretch: false, visibility: "sample", status: "fail", stdin: "2\n", expectedStdout: "4\n", actualStdout: "5\n" },
    { id: "b", name: "Hidden", stretch: false, visibility: "hidden", status: "fail", stdin: "SECRET_IN", expectedStdout: "SECRET_OUT", actualStdout: "SECRET_ACT", error: "SECRET_ERR" },
  ];
  const rows = toRows(results);
  assert.deepEqual(rows[0].detail, { stdin: "2\n", expectedStdout: "4\n", actualStdout: "5\n", error: undefined });
  assert.equal(rows[1].detail, undefined);
  assert.ok(!JSON.stringify(rows[1]).includes("SECRET"));
  assert.equal(rows[1].label, "✗ Failed");
});

test("a passing sample test hides the actual output; bonus tests are grouped apart", () => {
  const rows = toRows([
    { id: "a", name: "Sample", stretch: false, visibility: "sample", status: "pass", stdin: "1", expectedStdout: "1", actualStdout: "1" },
    { id: "b", name: "Bonus", stretch: true, visibility: "hidden", status: "pass" },
  ]);
  assert.equal(rows[0].detail?.actualStdout, undefined);
  assert.deepEqual(requiredRows(rows).map((r) => r.id), ["a"]);
  assert.deepEqual(bonusRows(rows).map((r) => r.id), ["b"]);
});

test("typescript maps to solution.ts and the typescript editor language; unknown falls back to javascript", () => {
  assert.equal(solutionFile("typescript"), "solution.ts");
  assert.equal(solutionFile("python"), "solution.py");
  assert.equal(solutionFile("javascript"), "solution.js");
  assert.equal(monacoLanguage("typescript"), "typescript");
  assert.equal(monacoLanguage("python"), "python");
  assert.equal(monacoLanguage(undefined), "javascript");
  assert.equal(monacoLanguage("ruby"), "javascript");
});

test("checkPractice posts code, language and lessonId to /api/sandbox/check", async () => {
  const seen: { url: string; body: unknown }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify({ results: [], complete: false }), { status: 200 });
  }) as typeof fetch;
  try {
    await checkPractice({ code: "x", language: "typescript", lessonId: "l1" });
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(seen, [{ url: "/api/sandbox/check", body: { code: "x", language: "typescript", lessonId: "l1" } }]);
});

test("hidden rows are locked with a status label after a check, and Locked before it", () => {
  const rows = toRows([
    { id: "a", name: "Sample", stretch: false, visibility: "sample", status: "pass" },
    { id: "b", name: "H1", stretch: false, visibility: "hidden", status: "pass" },
    { id: "c", name: "H2", stretch: false, visibility: "hidden", status: "fail" },
    { id: "d", name: "H3", stretch: true, visibility: "hidden", status: "timeout" },
    { id: "e", name: "H4", stretch: false, visibility: "hidden", status: "error" },
  ]);
  assert.deepEqual(rows.map((r) => r.locked), [false, true, true, true, true]);
  assert.deepEqual(rows.slice(1).map((r) => r.label), ["✓ Passed", "✗ Failed", "Timed out", "Error"]);
  assert.deepEqual(bonusRows(rows).map((r) => r.id), ["d"]);
  const before = previewRows([
    { id: "a", name: "Sample", visibility: "sample", stretch: false, stdin: "1", expectedStdout: "2" },
    { id: "b", name: "Hidden", visibility: "hidden", stretch: false },
    { id: "c", name: "Bonus", visibility: "hidden", stretch: true },
  ]);
  assert.deepEqual(before.map((r) => r.label), ["Not run", "Locked", "Locked"]);
  assert.deepEqual(before.map((r) => r.locked), [false, true, true]);
  assert.deepEqual(before[0].detail, { stdin: "1", expectedStdout: "2" });
  assert.equal(before[1].detail, undefined);
  assert.deepEqual(bonusRows(before).map((r) => r.id), ["c"]);
});
