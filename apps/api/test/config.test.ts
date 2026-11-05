import "./helpers.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { env } from "../src/env.ts";
import { reserveAiSpend } from "../src/config/budget.ts";

test("TIERS_JSON parses overrides and merges them over defaults", () => {
  const run = (tiers: string) => spawnSync(process.execPath, ["--input-type=module", "-e", `import { tiers } from './src/config/tiers.ts'; console.log(JSON.stringify(tiers))`], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, TIERS_JSON: tiers }, encoding: "utf8",
  });
  const good = run(JSON.stringify({ free: { aiPathsPerDay: 9, imagesPerDay: 3 } }));
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), {
    free: { aiPathsPerDay: 9, imagesPerDay: 3 },
    pro: { aiPathsPerDay: 20, imagesPerDay: 4 },
    max: { aiPathsPerDay: 50, imagesPerDay: 10 },
  });
  const bad = run("{");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /TIERS_JSON must contain valid JSON/);
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
    env.AI_DAILY_BUDGET_USD = Number(daily) + 3.5; // room for exactly 3 one-dollar reservations
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
