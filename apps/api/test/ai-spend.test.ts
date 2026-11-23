import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { signUp, trpc } from "./helpers.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { callEngine, EngineError } from "../src/engine-client/client.ts";
import { env } from "../src/env.ts";
import { aiCallSpend } from "../src/db/schema.ts";

const app = buildApp();
test.after(() => app.close());

test("each reported model call stores only day, tokens and cost, and only admins can read period totals", async (t) => {
  await db.delete(aiCallSpend);
  const savedToken = env.ENGINE_TOKEN;
  t.after(async () => {
    env.ENGINE_TOKEN = savedToken;
    await db.delete(aiCallSpend);
  });

  const email = "private-learner@example.test";
  const account = trpc(app, await signUp(app, email));
  equal((await trpc(app).q("admin.dashboard")).statusCode, 401);
  equal((await account.q("admin.dashboard")).statusCode, 403);
  await db.execute(sql`UPDATE learners SET is_admin = true WHERE user_id = (
    SELECT id FROM "user" WHERE email = ${email})`);
  equal((await account.q("admin.dashboard")).statusCode, 200);

  await db.execute(sql`INSERT INTO ai_call_spend (day, prompt_tokens, completion_tokens, estimated_usd)
    VALUES (date_trunc('month', now() AT TIME ZONE 'UTC')::date - 1, 900, 500, 10)`);
  const request = { learnerEmail: email, learnerId: "private-id", topic: "private prompt and code" };
  env.ENGINE_TOKEN = "test-engine-token-not-for-production";
  const engine = t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ error: "invalid_output" }),
    {
      status: 422,
      headers: { "x-engine-usage": JSON.stringify([
        { model: "openai/gpt-5.1", prompt_tokens: 1_000, completion_tokens: 100, prompt: request.topic },
        { model: "unknown-model", prompt_tokens: 200, completion_tokens: 40, email },
      ]) },
    },
  ));
  await rejects(() => callEngine("/v1/pipeline/outline", request), (error: unknown) =>
    error instanceof EngineError && error.status === 422);
  engine.mock.restore();

  const { rows: [clock] } = await db.execute<{ day: string }>(sql`
    SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day`);
  const rows = await db.select().from(aiCallSpend).where(sql`${aiCallSpend.day} = ${clock.day}`)
    .orderBy(aiCallSpend.promptTokens);
  deepEqual(rows, [
    { day: clock.day, promptTokens: 200, completionTokens: 40, estimatedUsd: null },
    { day: clock.day, promptTokens: 1_000, completionTokens: 100, estimatedUsd: "0.002250000000" },
  ]);

  const dashboard = await account.q("admin.dashboard");
  equal(dashboard.statusCode, 200);
  const totals = { calls: 2, promptTokens: 1_200, completionTokens: 140, estimatedUsd: 0.00225, unpricedCalls: 1 };
  deepEqual(JSON.parse(dashboard.body), { result: { data: { monthToDate: totals, days: [{ day: clock.day, ...totals }] } } });

  await db.execute(sql`UPDATE learners SET is_admin = false WHERE is_admin`);
  equal((await account.q("admin.dashboard")).statusCode, 403);
});
