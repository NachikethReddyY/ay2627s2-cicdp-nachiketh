import { signUp } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { SandboxNotRunningError, setBackend, type DirEntry, type SandboxFileName } from "../src/sandbox/backend.ts";

const app = buildApp();
env.SANDBOX_ENABLED = true;
after(() => {
  setBackend(null);
  return app.close();
});

function fakeFiles(opts: { throwNotRunning?: boolean; entries?: number; missing?: boolean; omit?: boolean } = {}) {
  const rec = {
    writes: [] as { learnerId: string; name: SandboxFileName; content: string }[],
    lists: [] as { learnerId: string; relDir: string }[],
    maxInFlight: 0,
  };
  let inFlight = 0;
  const writeFile = async (learnerId: string, name: SandboxFileName, content: string) => {
    inFlight++;
    rec.maxInFlight = Math.max(rec.maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 20));
      if (opts.throwNotRunning) throw new SandboxNotRunningError();
      rec.writes.push({ learnerId, name, content });
    } finally {
      inFlight--;
    }
  };
  const listDir = async (learnerId: string, relDir: string) => {
    rec.lists.push({ learnerId, relDir });
    if (opts.throwNotRunning) throw new SandboxNotRunningError();
    if (opts.missing) return null;
    const entries: DirEntry[] = Array.from({ length: opts.entries ?? 2 }, (_, i) => ({
      name: "f".repeat(80) + i,
      type: "file",
      size: i,
    }));
    return { entries, truncated: false };
  };
  setBackend({
    openShell: async () => {
      throw new Error("unused");
    },
    ...(opts.omit ? {} : { writeFile, listDir }),
  });
  return rec;
}

const put = (cookie: string, name: string, body: unknown, origin: string = env.PUBLIC_ORIGIN) =>
  app.inject({ method: "PUT", url: `/api/sandbox/files/${name}`, headers: { cookie, origin }, payload: body as object });
const list = (cookie: string, dir?: string) =>
  app.inject({
    method: "GET",
    url: `/api/sandbox/files${dir === undefined ? "" : `?dir=${encodeURIComponent(dir)}`}`,
    headers: { cookie },
  });

test("signed out is 401 and a disabled sandbox is 503", async () => {
  fakeFiles();
  assert.equal((await put("", "solution.py", { content: "x" })).statusCode, 401);
  assert.equal((await list("")).statusCode, 401);
  env.SANDBOX_ENABLED = false;
  try {
    assert.equal((await list(await signUp(app))).statusCode, 503);
  } finally {
    env.SANDBOX_ENABLED = true;
  }
});

test("only the two allowlisted names can be written", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles();
  for (const n of ["main.py", "solution.PY", "..%2fsolution.py", ".bashrc", "solution.py.bak"])
    assert.equal((await put(cookie, n, { content: "x" })).statusCode, 400, n);
  // inject() normalises "/files/%2e%2e" to "/", so the request never reaches the route: 404, and nothing is written.
  assert.equal((await put(cookie, "%2e%2e", { content: "x" })).statusCode, 404);
  assert.equal((await put(cookie, "solution.js", { content: "console.log(1)" })).statusCode, 204);
  assert.deepEqual(f.writes.map((w) => w.name), ["solution.js"]);
});

test("dir must be up to 4 safe segments", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles();
  for (const d of ["..", "a/../b", "/etc", "%2e%2e", "a//b", "a/b/c/d/e", "a b", "x".repeat(65), "."])
    assert.equal((await list(cookie, d)).statusCode, 400, d);
  assert.equal((await list(cookie, "a/b.c/d_e/f-g")).statusCode, 200);
  assert.equal((await list(cookie)).statusCode, 200);
  assert.deepEqual(f.lists.map((l) => l.relDir), ["a/b.c/d_e/f-g", ""]);
});

test("content over MAX_CODE is 400; 4000 three-byte characters fit the body limit", async () => {
  const cookie = await signUp(app);
  fakeFiles();
  assert.equal((await put(cookie, "solution.py", { content: "x".repeat(4001) })).statusCode, 400);
  assert.equal((await put(cookie, "solution.py", { content: "界".repeat(4000) })).statusCode, 204);
  assert.equal((await put(cookie, "solution.py", { content: "x".repeat(17 * 1024) })).statusCode, 413);
});

test("a foreign origin is 403 on PUT", async () => {
  fakeFiles();
  assert.equal((await put(await signUp(app), "solution.py", { content: "x" }, "https://evil.example")).statusCode, 403);
});

test("no running shell is 409 no_shell; a backend without the methods is 501", async () => {
  const cookie = await signUp(app);
  fakeFiles({ throwNotRunning: true });
  const r = await put(cookie, "solution.py", { content: "x" });
  assert.equal(r.statusCode, 409);
  assert.deepEqual(r.json(), { error: { code: "no_shell", message: "Open the terminal first" } });
  assert.equal((await list(cookie)).statusCode, 409);
  fakeFiles({ omit: true });
  assert.equal((await list(cookie)).statusCode, 501);
});

test("a missing directory is 404", async () => {
  fakeFiles({ missing: true });
  assert.equal((await list(await signUp(app), "gone")).statusCode, 404);
});

test("the 31st write and the 61st list in a minute are 429", async () => {
  const cookie = await signUp(app);
  fakeFiles();
  for (let i = 0; i < 30; i++) assert.equal((await put(cookie, "solution.py", { content: "x" })).statusCode, 204);
  assert.equal((await put(cookie, "solution.py", { content: "x" })).statusCode, 429);
  for (let i = 0; i < 60; i++) assert.equal((await list(cookie)).statusCode, 200);
  assert.equal((await list(cookie)).statusCode, 429);
});

test("each learner's calls carry only their own id", async () => {
  const a = await signUp(app);
  const b = await signUp(app, "files-b@example.com");
  const f = fakeFiles();
  await put(a, "solution.py", { content: "a" });
  await put(b, "solution.py", { content: "b" });
  assert.equal(new Set(f.writes.map((w) => w.learnerId)).size, 2);
  assert.notEqual(f.writes[0]!.learnerId, f.writes[1]!.learnerId);
});

test("a listing is capped at 200 entries and names at 64 characters", async () => {
  fakeFiles({ entries: 250 });
  const body = (await list(await signUp(app))).json();
  assert.equal(body.entries.length, 200);
  assert.equal(body.truncated, true);
  assert.ok(body.entries.every((e: { name: string }) => e.name.length <= 64));
});

test("a learner's backend calls run one at a time", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles();
  await Promise.all([1, 2, 3].map(() => put(cookie, "solution.py", { content: "x" })));
  assert.equal(f.maxInFlight, 1);
});
