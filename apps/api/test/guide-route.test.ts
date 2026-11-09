// No database: the chat is only checked up to its sign-in guard, so no learner or engine call happens.
process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const { guideRoutes } = await import("../src/dev/route.ts");

async function appWithGuide() {
  const app = Fastify();
  app.register(guideRoutes);
  return app;
}

test("POST /guide/chat is registered in production with no flag (401 without a session)", async () => {
  const app = await appWithGuide();
  // No session: the sign-in guard answers before any engine call.
  const res = await app.inject({ method: "POST", url: "/guide/chat", payload: {} });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, "unauthorized");
  await app.close();
});

test("GET /guide/status is gone", async () => {
  const app = await appWithGuide();
  const res = await app.inject({ method: "GET", url: "/guide/status" });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("POST /dev/guide-chat is gone", async () => {
  const app = await appWithGuide();
  const res = await app.inject({ method: "POST", url: "/dev/guide-chat", payload: {} });
  assert.equal(res.statusCode, 404);
  await app.close();
});
