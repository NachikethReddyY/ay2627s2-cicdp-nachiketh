import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPassed, listFiles, startPython } from "./runPython.ts";

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
