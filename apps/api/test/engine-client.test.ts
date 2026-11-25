import assert from "node:assert/strict";
import { test } from "node:test";
import "./helpers.ts";
import { callEngine } from "../src/engine-client/client.ts";
import { env } from "../src/env.ts";

test("pipeline requests wake a sleeping Render engine before posting and share the readiness check", async (t) => {
  env.ENGINE_URL = "https://example-engine.onrender.com";
  env.ENGINE_TOKEN = "t".repeat(32);
  let awake = false;
  let healthChecks = 0;
  const requestPaths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL, options: RequestInit) => {
    requestPaths.push(url.pathname);
    if (url.pathname === "/healthz") {
      assert.equal(new Headers(options.headers).has("x-engine-token"), false);
      healthChecks++;
      if (healthChecks === 1) return new Response(null, { status: 503 });
      awake = true;
      return Response.json({ ok: true });
    }
    assert.equal(awake, true);
    assert.equal(options.method, "POST");
    return Response.json({ plan: { topics: [] } });
  });

  const plan = () => callEngine("/v1/pipeline/roadmap-topics", { topic: "JavaScript closures" });
  await assert.rejects(plan(), { status: 503 });
  await Promise.all([plan(), plan()]);
  await plan();
  assert.deepEqual(requestPaths, [
    "/healthz",
    "/healthz",
    "/v1/pipeline/roadmap-topics",
    "/v1/pipeline/roadmap-topics",
    "/v1/pipeline/roadmap-topics",
  ]);
});
