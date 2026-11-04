// No database: this file does not import helpers.ts, so it only needs the env.ts variables below.
process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

const { devRoutes } = await import("../src/dev/route.ts");

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
