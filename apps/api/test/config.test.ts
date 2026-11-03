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
  const good = run(JSON.stringify({ free: { aiPathsPerDay: 9, visualsPerDay: 2, imagesPerDay: 3 } }));
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout), {
    free: { aiPathsPerDay: 9, visualsPerDay: 2, imagesPerDay: 3 },
    pro: { aiPathsPerDay: 20, visualsPerDay: 4, imagesPerDay: 4 },
    max: { aiPathsPerDay: 50, visualsPerDay: 10, imagesPerDay: 10 },
  });
  const bad = run("{");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /TIERS_JSON must contain valid JSON/);
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
