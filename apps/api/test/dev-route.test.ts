// No database: this file does not import helpers.ts, so it only needs the env.ts variables below.
process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const { devRoutes, readGuideWorkspaceFiles, guideBodyTooLarge } = await import("../src/dev/route.ts");

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
  // 30,000 CJK characters are 90,000 bytes in UTF-8, over the 64 KiB engine limit, though only 30,000 characters.
  const cjk = { prompt: "文".repeat(30_000) };
  assert.equal(guideBodyTooLarge(cjk), true);
  // The same character count in ASCII is 30,000 bytes and fits.
  assert.equal(guideBodyTooLarge({ prompt: "a".repeat(30_000) }), false);
});
