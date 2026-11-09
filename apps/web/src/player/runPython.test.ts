import { test } from "node:test";
import assert from "node:assert/strict";
import { askEditorGuide, checkPassed, lintPractice, listFiles, startPython } from "./runPython.ts";

test("Check sends the lesson id so the server judges the run; Run does not", async () => {
  const bodies: unknown[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ id: "r1" }), { status: 200 });
  }) as typeof fetch;
  try {
    await startPython("print(1)", "python", "prac-1");
    await startPython("print(1)", "python");
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(bodies, [
    { code: "print(1)", language: "python", lessonId: "prac-1" },
    { code: "print(1)", language: "python" },
  ]);
});

test("a Check passes only on the server's verdict", () => {
  assert.equal(checkPassed({ passed: true }), true);
  assert.equal(checkPassed({ passed: false }), false);
  assert.equal(checkPassed({}), false, "no verdict is a fail");
  assert.equal(checkPassed({ passed: true, error: "Could not save your result. Check again." }), false);
});

test("listFiles asks for one directory level and encodes dir", async () => {
  const urls: string[] = []; const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ entries: [], truncated: false }), { status: 200 }); }) as typeof fetch;
  try { await listFiles(); await listFiles("my dir/sub"); } finally { globalThis.fetch = real; }
  assert.deepEqual(urls, ["/api/sandbox/files", "/api/sandbox/files?dir=my%20dir%2Fsub"]);
});

test("lintPractice posts only the code and language to /api/practice/lint", async () => {
  const real = globalThis.fetch;
  let seen: { url: string; body: unknown } | undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(init.body as string) };
    return new Response(JSON.stringify({ findings: [{ ruleId: "prefer-const", line: 4, column: 1, message: "Use const" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const res = await lintPractice("let a = 1", "javascript");
    assert.equal(res.findings[0].line, 4);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(seen, { url: "/api/practice/lint", body: { code: "let a = 1", language: "javascript" } });
});

test("askEditorGuide sends the finding pointer when given, and omits it otherwise", async () => {
  const real = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ guide: { message: "ok", widgets: [] } }), { status: 200 });
  }) as typeof fetch;
  const base = { fileName: "solution.js", projectRoot: ".", language: "javascript", code: "c", selection: "", messages: [] };
  try {
    await askEditorGuide({ ...base, finding: { ruleId: "prefer-const", line: 4, column: 2 } });
    await askEditorGuide(base);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(bodies[0].finding, { ruleId: "prefer-const", line: 4, column: 2 });
  assert.equal("finding" in bodies[1], false);
});
