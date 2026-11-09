// No database: the chat is only checked up to its sign-in guard, so no learner or engine call happens.
process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const { env } = await import("../src/env.ts");
const { guideRoutes } = await import("../src/dev/route.ts");

async function appWithGuide() {
  const app = Fastify();
  app.register(guideRoutes);
  return app;
}

async function withFlag(enabled: boolean, run: () => Promise<void>) {
  const saved = env.SLOPPY_ENABLED;
  env.SLOPPY_ENABLED = enabled;
  try {
    await run();
  } finally {
    env.SLOPPY_ENABLED = saved;
  }
}

test("GET /guide/status reports enabled false by default", async () => {
  await withFlag(false, async () => {
    const app = await appWithGuide();
    const res = await app.inject({ method: "GET", url: "/guide/status" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { enabled: false });
    await app.close();
  });
});

test("GET /guide/status reports enabled true when SLOPPY_ENABLED is set", async () => {
  await withFlag(true, async () => {
    const app = await appWithGuide();
    const res = await app.inject({ method: "GET", url: "/guide/status" });
    assert.deepEqual(res.json(), { enabled: true });
    await app.close();
  });
});

test("POST /guide/chat is 404 in production when SLOPPY_ENABLED is off", async () => {
  await withFlag(false, async () => {
    const app = await appWithGuide();
    const res = await app.inject({ method: "POST", url: "/guide/chat", payload: {} });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

test("POST /dev/guide-chat is gone", async () => {
  await withFlag(true, async () => {
    const app = await appWithGuide();
    const res = await app.inject({ method: "POST", url: "/dev/guide-chat", payload: {} });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

test("POST /guide/chat is registered when SLOPPY_ENABLED is set", async () => {
  await withFlag(true, async () => {
    const app = await appWithGuide();
    // No session: the sign-in guard answers before any engine call.
    const res = await app.inject({ method: "POST", url: "/guide/chat", payload: {} });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, "unauthorized");
    await app.close();
  });
});

test("POST /guide/chat is registered in development without the flag", async () => {
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    await withFlag(false, async () => {
      const app = await appWithGuide();
      const res = await app.inject({ method: "POST", url: "/guide/chat", payload: {} });
      assert.equal(res.statusCode, 401);
      await app.close();
    });
  } finally {
    process.env.NODE_ENV = savedEnv;
  }
});
