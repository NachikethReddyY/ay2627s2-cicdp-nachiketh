import "./helpers.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { env, parseEnv } from "../src/env.ts";
import { reserveAiSpend } from "../src/config/budget.ts";

const imageEnv = {
  DATABASE_URL: "postgres://localhost/learnquest_test",
  BETTER_AUTH_SECRET: "test-only-secret-not-for-production-0123456789",
  IMAGE_MODEL: "image-model",
};

test("image generation prefers the TokenRouter key and honors an explicit base URL", () => {
  const parsed = parseEnv({
    ...imageEnv,
    TOKENROUTER_API_KEY: "router-key",
    IMAGE_API_KEY: "legacy-key",
    IMAGE_BASE_URL: "https://images.example/v1",
  });
  assert.ok(parsed.success);
  assert.equal(parsed.data.IMAGE_API_KEY, "router-key");
  assert.equal(parsed.data.IMAGE_BASE_URL, "https://images.example/v1");
});

test("image generation falls back to the legacy key and requires its base URL", () => {
  const legacyEnv = { ...imageEnv, TOKENROUTER_API_KEY: "", IMAGE_API_KEY: "legacy-key" };
  const parsed = parseEnv({ ...legacyEnv, IMAGE_BASE_URL: "https://images.example/v1" });
  assert.ok(parsed.success);
  assert.equal(parsed.data.IMAGE_API_KEY, "legacy-key");
  assert.equal(parsed.data.IMAGE_BASE_URL, "https://images.example/v1");
  assert.equal(parseEnv(legacyEnv).data?.IMAGE_BASE_URL, undefined);
});

test("the default TokenRouter image URL enables the production spend-cap check", () => {
  const productionEnv = { ...imageEnv, NODE_ENV: "production", TOKENROUTER_API_KEY: "router-key" };
  const uncapped = parseEnv(productionEnv);
  assert.equal(uncapped.success, false);
  assert.deepEqual(uncapped.error?.issues[0]?.path, ["AI_DAILY_BUDGET_USD"]);
  const parsed = parseEnv({ ...productionEnv, AI_DAILY_BUDGET_USD: "5" });
  assert.ok(parsed.success);
  assert.equal(parsed.data.IMAGE_API_KEY, "router-key");
  assert.equal(parsed.data.IMAGE_BASE_URL, "https://api.tokenrouter.com/v1");
  assert.ok(parseEnv({ ...productionEnv, IMAGE_MODEL: undefined }).success);
});

test("a blank IMAGE_ESTIMATE_USD falls back to the 0.04 default instead of 0", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import { env } from './src/env.ts'; console.log(env.IMAGE_ESTIMATE_USD)`], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, IMAGE_ESTIMATE_USD: "" }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "0.04");
});

test("reserveAiSpend refuses daily and monthly overages and the kill switch", async () => {
  const ids = [randomUUID(), randomUUID()];
  const old = { daily: env.AI_DAILY_BUDGET_USD, monthly: env.AI_MONTHLY_BUDGET_USD, kill: env.AI_KILL_SWITCH };
  try {
    await db.execute(sql`INSERT INTO spend_ledger (id, amount_usd) VALUES (${ids[0]}, 10), (${ids[1]}, 10)`);
    env.AI_KILL_SWITCH = false;
    env.AI_DAILY_BUDGET_USD = 10;
    env.AI_MONTHLY_BUDGET_USD = 100;
    await assert.rejects(reserveAiSpend(1), (e: any) => e.code === "TOO_MANY_REQUESTS");
    env.AI_DAILY_BUDGET_USD = 100;
    env.AI_MONTHLY_BUDGET_USD = 10;
    await assert.rejects(reserveAiSpend(1), (e: any) => e.code === "TOO_MANY_REQUESTS");
    env.AI_KILL_SWITCH = true;
    await assert.rejects(reserveAiSpend(0), (e: any) => e.code === "PRECONDITION_FAILED");
  } finally {
    env.AI_DAILY_BUDGET_USD = old.daily;
    env.AI_MONTHLY_BUDGET_USD = old.monthly;
    env.AI_KILL_SWITCH = old.kill;
    await db.execute(sql`DELETE FROM spend_ledger WHERE id IN (${ids[0]}, ${ids[1]})`);
  }
});

test("reserveAiSpend serializes parallel reservations so only what fits succeeds", async () => {
  const old = { daily: env.AI_DAILY_BUDGET_USD, monthly: env.AI_MONTHLY_BUDGET_USD, kill: env.AI_KILL_SWITCH };
  const { rows: before } = await db.execute<{ id: string }>(sql`SELECT id FROM spend_ledger`);
  try {
    env.AI_KILL_SWITCH = false;
    env.AI_MONTHLY_BUDGET_USD = 0;
    const { rows: [{ daily }] } = await db.execute<{ daily: string }>(
      sql`SELECT COALESCE(sum(amount_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS daily FROM spend_ledger`);
    env.AI_DAILY_BUDGET_USD = Number(daily) + 3.5;
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveAiSpend(1)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    for (const r of results) if (r.status === "rejected") assert.equal(r.reason.code, "TOO_MANY_REQUESTS");
  } finally {
    env.AI_DAILY_BUDGET_USD = old.daily;
    env.AI_MONTHLY_BUDGET_USD = old.monthly;
    env.AI_KILL_SWITCH = old.kill;
    const keep = before.map((r) => r.id);
    await db.execute(keep.length ? sql`DELETE FROM spend_ledger WHERE id NOT IN (${sql.join(keep.map((i) => sql`${i}`), sql`, `)})` : sql`DELETE FROM spend_ledger`);
  }
});
