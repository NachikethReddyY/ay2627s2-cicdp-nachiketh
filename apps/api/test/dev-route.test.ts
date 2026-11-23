process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const { devRoutes, readGuideWorkspaceFiles, guideBodyTooLarge } = await import("../src/dev/route.ts");
const { env } = await import("../src/env.ts");
const { SandboxFileTooLargeError, SandboxNotRunningError } = await import("../src/sandbox/backend.ts");

test("POST /dev/visual is 404 in production", async () => {
  const app = Fastify();
  app.register(devRoutes);
  const res = await app.inject({ method: "POST", url: "/dev/visual", payload: { prompt: "a chart" } });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("POST /dev/visual is 404 when NODE_ENV is unset", async () => {
  const saved = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const app = Fastify();
  app.register(devRoutes);
  const res = await app.inject({ method: "POST", url: "/dev/visual", payload: { prompt: "a chart" } });
  process.env.NODE_ENV = saved;
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("the development visual route validates the prompt and translates engine responses", async (t) => {
  const previous = { mode: process.env.NODE_ENV, token: env.ENGINE_TOKEN };
  process.env.NODE_ENV = "development";
  env.ENGINE_TOKEN = undefined;
  const app = Fastify();
  t.after(async () => {
    process.env.NODE_ENV = previous.mode;
    env.ENGINE_TOKEN = previous.token;
    await app.close();
  });
  app.register(devRoutes);
  const plot = (prompt: string) => app.inject({ method: "POST", url: "/dev/visual", payload: { prompt } });
  const missing = await plot("a chart");
  assert.equal(missing.statusCode, 502);
  assert.match(missing.json().error.message, /ENGINE_TOKEN is not set in apps\/api\/\.env/);
  env.ENGINE_TOKEN = "test-token";
  const requests: unknown[] = [];
  let response = Response.json({ title: "Preview" });
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    requests.push([url.pathname, options.body]);
    return response;
  });
  assert.equal((await plot("")).statusCode, 400);
  assert.deepEqual(requests, []);
  assert.deepEqual((await plot("a chart")).json(), { title: "Preview" });
  response = Response.json({ error: "Invalid visual", issues: ["Missing axis", "Empty series"] }, { status: 422 });
  const invalid = await plot("a chart");
  assert.equal(invalid.statusCode, 502);
  assert.deepEqual(invalid.json(), { error: { code: "engine_error", message: "Invalid visual (Missing axis; Empty series)" } });
  assert.deepEqual(requests, Array.from({ length: 2 }, () => ["/v1/pipeline/visual", JSON.stringify({ prompt: "a chart" })]));
});

test("guide context includes project text files and skips secrets and generated folders", async () => {
  const listed = new Map<string, { name: string; type: "file" | "dir"; size: number }[]>([
    ["task-tracker", [
      { name: "INSTRUCTIONS.md", type: "file", size: 30 },
      { name: "README.md", type: "file", size: 20 },
      { name: ".env", type: "file", size: 12 },
      { name: "node_modules", type: "dir", size: 0 },
      { name: "src", type: "dir", size: 0 },
    ]],
    ["task-tracker/src", [{ name: "app.js", type: "file", size: 50 }]],
  ]);
  const backend = {
    listDir: async (_learner: string, dir: string) => ({ entries: listed.get(dir) ?? [], truncated: false }),
    readWorkspaceFile: async (_learner: string, path: string) => `contents of ${path}`,
  };

  const files = await readGuideWorkspaceFiles(backend, "learner-a", "task-tracker");
  assert.deepEqual(files.map((file) => file.path), [
    "task-tracker/INSTRUCTIONS.md",
    "task-tracker/README.md",
    "task-tracker/src/app.js",
  ]);
  assert.deepEqual(await readGuideWorkspaceFiles(backend, "learner-a", "../outside"), []);
});

test("guide body over the engine limit is measured in UTF-8 bytes, so CJK text is rejected", () => {
  const cjk = { prompt: "文".repeat(30_000) };
  assert.equal(guideBodyTooLarge(cjk), true);
  assert.equal(guideBodyTooLarge({ prompt: "a".repeat(30_000) }), false);
});

test("guide workspace reads skip missing and oversized files while applying per-file and total limits", async () => {
  const names = ["missing.js", "huge.js", "small.js", "a.js", "b.js", "c.js", "unread.js"];
  const reads: string[] = [];
  const backend = {
    listDir: async () => ({ entries: names.map((name) => ({ name, type: "file" as const, size: 0 })), truncated: false }),
    readWorkspaceFile: async (_learner: string, path: string) => {
      const name = path.slice("project/".length);
      reads.push(name);
      if (name === "missing.js") return null;
      if (name === "huge.js") throw new SandboxFileTooLargeError();
      return name === "small.js" ? "let x = 1;" : "x".repeat(7000);
    },
  };
  const files = await readGuideWorkspaceFiles(backend, "learner", "project");
  assert.deepEqual(files.map((file) => [file.path, file.content.length]), [
    ["project/small.js", 10], ["project/a.js", 6000], ["project/b.js", 6000], ["project/c.js", 5990],
  ]);
  assert.deepEqual(reads, names.slice(0, -1));
  await assert.rejects(readGuideWorkspaceFiles({
    ...backend,
    readWorkspaceFile: async () => { throw new SandboxNotRunningError(); },
  }, "learner", "project"), SandboxNotRunningError);
});
