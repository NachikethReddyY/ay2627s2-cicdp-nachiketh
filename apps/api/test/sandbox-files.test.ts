import { signUp } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { limiter } from "../src/sandbox/files.ts";
import { SandboxFileTooLargeError, SandboxNotRunningError, setBackend, type DirEntry, type SandboxFileName } from "../src/sandbox/backend.ts";

const app = buildApp();
env.SANDBOX_ENABLED = true;
after(() => {
  setBackend(null);
  return app.close();
});

function fakeFiles(opts: { throwNotRunning?: boolean; entries?: number; missing?: boolean; omit?: boolean; files?: Record<string, string> } = {}) {
  const rec = {
    writes: [] as { learnerId: string; name: SandboxFileName; content: string }[],
    workspaceWrites: [] as { learnerId: string; path: string; content: string }[],
    lists: [] as { learnerId: string; relDir: string }[],
    workspaceReads: [] as { learnerId: string; path: string }[],
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
  const writeWorkspaceFile = async (learnerId: string, path: string, content: string) => {
    rec.workspaceWrites.push({ learnerId, path, content });
  };
  const readWorkspaceFile = async (learnerId: string, path: string) => {
    rec.workspaceReads.push({ learnerId, path });
    if (opts.throwNotRunning) throw new SandboxNotRunningError();
    if (path.startsWith("huge/")) throw new SandboxFileTooLargeError();
    return opts.files?.[path] ?? null;
  };
  setBackend({
    openShell: async () => {
      throw new Error("unused");
    },
    ...(opts.omit ? {} : { writeFile, listDir, writeWorkspaceFile, readWorkspaceFile }),
  });
  return rec;
}

const put = (cookie: string, name: string, body: unknown, origin: string = env.PUBLIC_ORIGIN) =>
  app.inject({ method: "PUT", url: `/api/sandbox/files/${name}`, headers: { cookie, origin }, payload: body as object });
const putWorkspace = (cookie: string, body: unknown) =>
  app.inject({ method: "PUT", url: "/api/sandbox/workspace-file", headers: { cookie, origin: env.PUBLIC_ORIGIN }, payload: body as object });
const list = (cookie: string, dir?: string) =>
  app.inject({
    method: "GET",
    url: `/api/sandbox/files${dir === undefined ? "" : `?dir=${encodeURIComponent(dir)}`}`,
    headers: { cookie },
  });
const batchRead = (cookie: string, paths: string[]) =>
  app.inject({ method: "POST", url: "/api/sandbox/workspace-files/read", headers: { cookie, origin: env.PUBLIC_ORIGIN }, payload: { paths } });
const listBatch = (cookie: string, dirs: string[]) =>
  app.inject({ method: "GET", url: `/api/sandbox/files/batch?${dirs.map((dir) => `dir=${encodeURIComponent(dir)}`).join("&")}`, headers: { cookie } });

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

test("dir must be up to 8 safe segments", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles();
  for (const d of ["..", "a/../b", "/etc", "%2e%2e", "a//b", "a/b/c/d/e/f/g/h/i", "a b", "x".repeat(65), "."])
    assert.equal((await list(cookie, d)).statusCode, 400, d);
  assert.equal((await list(cookie, "a/b.c/d_e/f-g")).statusCode, 200);
  assert.equal((await list(cookie, "task-tracker/web/src/components")).statusCode, 200);
  assert.equal((await list(cookie)).statusCode, 200);
  assert.deepEqual(f.lists.map((l) => l.relDir), ["a/b.c/d_e/f-g", "task-tracker/web/src/components", ""]);
});

test("a four-segment file path reads, and one invalid path in a batch is skipped without failing the rest", async () => {
  const cookie = await signUp(app);
  const nested = "task-tracker/web/src/lib/util.ts";
  fakeFiles({ files: { [nested]: "export const x = 1;", "src/a.ts": "a" } });
  const r = await batchRead(cookie, [nested, "../secret", "src/a.ts"]);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().files, [
    { path: nested, content: "export const x = 1;" },
    { path: "src/a.ts", content: "a" },
  ]);
  assert.deepEqual(r.json().skipped, [{ path: "../secret", reason: "invalid_path" }]);
});

test("content over MAX_CODE is 400; 4000 three-byte characters fit the body limit", async () => {
  const cookie = await signUp(app);
  fakeFiles();
  assert.equal((await put(cookie, "solution.py", { content: "x".repeat(4001) })).statusCode, 400);
  assert.equal((await put(cookie, "solution.py", { content: "界".repeat(4000) })).statusCode, 204);
  assert.equal((await put(cookie, "solution.py", { content: "x".repeat(17 * 1024) })).statusCode, 413);
});

test("workspace save rejects content over 64 KiB of UTF-8 even when it has fewer characters", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles();
  // 43690 CJK characters: under the 65536 character limit, but 131070 UTF-8 bytes.
  const r = await putWorkspace(cookie, { path: "src", content: "界".repeat(43690) });
  assert.equal(r.statusCode, 413);
  assert.equal(r.json().error.code, "file_too_large");
  assert.equal(f.workspaceWrites.length, 0);
});

test("workspace save accepts ASCII content of exactly 64 KiB", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles();
  assert.equal((await putWorkspace(cookie, { path: "src", content: "x".repeat(64 * 1024) })).statusCode, 204);
  assert.equal(f.workspaceWrites.length, 1);
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

test("batch listing returns several directories in one request and rejects unsafe paths", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles();
  const response = await listBatch(cookie, ["", "src", "src/lib"]);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.json().directories), ["", "src", "src/lib"]);
  assert.deepEqual(f.lists.map((item) => item.relDir), ["", "src", "src/lib"]);
  assert.equal((await listBatch(cookie, ["src", "../private"])).statusCode, 400);
  assert.equal((await listBatch(cookie, [])).statusCode, 400);
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

test("the rate limiter prunes expired windows once the map is large, and still limits an active one", () => {
  let now = 1_000_000;
  const allowed = limiter(2, () => now);
  for (let i = 0; i < 1000; i++) assert.equal(allowed(`old-${i}`), true);
  now += 30_000;
  assert.equal(allowed("active"), true);
  assert.equal(allowed("active"), true);
  assert.equal(allowed("active"), false);
  now += 31_000; // the old windows are over a minute old, the active one is not
  assert.equal(allowed.size(), 1001);
  assert.equal(allowed("new"), true); // map is over the threshold, so this call prunes the expired windows
  assert.equal(allowed.size(), 2, "only the active and the new window remain");
  assert.equal(allowed("active"), false, "a window still inside its minute keeps limiting after a prune");
  assert.equal(allowed("old-0"), true, "a pruned learner starts a fresh window");
});

test("batch read returns found files, lists missing and oversized ones as skipped, and counts once against the list budget", async () => {
  const cookie = await signUp(app);
  const f = fakeFiles({ files: { "src/a.js": "a", "src/b.js": "b" } });
  const readBatch = (who: string, paths: unknown) =>
    app.inject({ method: "POST", url: "/api/sandbox/workspace-files/read", headers: { cookie: who, origin: env.PUBLIC_ORIGIN }, payload: { paths } as object });
  const r = await readBatch(cookie, ["src/a.js", "src/missing.js", "huge/x.bin", "src/b.js"]);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), {
    files: [{ path: "src/a.js", content: "a" }, { path: "src/b.js", content: "b" }],
    skipped: [{ path: "src/missing.js", reason: "not_found" }, { path: "huge/x.bin", reason: "file_too_large" }],
  });
  assert.deepEqual(f.workspaceReads.map((x) => x.path), ["src/a.js", "src/missing.js", "huge/x.bin", "src/b.js"]);

  const many = Array.from({ length: 64 }, (_, i) => `src/f${i}.js`);
  assert.equal((await readBatch(cookie, many)).statusCode, 200);
  assert.equal((await readBatch(cookie, [...many, "src/extra.js"])).statusCode, 400, "65 paths");
  assert.equal((await readBatch(cookie, [])).statusCode, 400);
  // An unsafe path is skipped on its own; the batch still answers 200 with the other files.
  const unsafe = await readBatch(cookie, ["../private", "src//a.js", "src/a.js"]);
  assert.equal(unsafe.statusCode, 200);
  assert.deepEqual(unsafe.json().files, [{ path: "src/a.js", content: "a" }]);
  assert.deepEqual(unsafe.json().skipped, [
    { path: "../private", reason: "invalid_path" },
    { path: "src//a.js", reason: "invalid_path" },
  ]);
  assert.equal((await readBatch(cookie, [7])).statusCode, 400);
  const oversized = await app.inject({ method: "POST", url: "/api/sandbox/workspace-files/read", headers: { cookie, origin: env.PUBLIC_ORIGIN }, payload: { paths: ["x".repeat(40_000)] } as object });
  assert.equal(oversized.statusCode, 413, "body over 32 KiB");

  // Each batch is one list-budget call, whatever its size. A fresh learner gets 60 full batches before the 61st is limited.
  const fresh = await signUp(app, "files-batch@example.com");
  for (let i = 0; i < 60; i++) assert.equal((await readBatch(fresh, many)).statusCode, 200, `batch ${i}`);
  assert.equal((await readBatch(fresh, many)).statusCode, 429);
});

test("batch read with no running shell is 409 no_shell", async () => {
  const cookie = await signUp(app);
  fakeFiles({ throwNotRunning: true });
  const r = await app.inject({ method: "POST", url: "/api/sandbox/workspace-files/read", headers: { cookie, origin: env.PUBLIC_ORIGIN }, payload: { paths: ["a.js"] } as object });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error.code, "no_shell");
});
