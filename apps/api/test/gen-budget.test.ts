import "./helpers.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { env } from "../src/env.ts";
import { ENGINE_CALLS_PER_PART, reserveAiSpend } from "../src/config/budget.ts";

const saved = { d: env.AI_DAILY_BUDGET_USD, m: env.AI_MONTHLY_BUDGET_USD, k: env.AI_KILL_SWITCH };
afterEach(async () => {
  Object.assign(env, { AI_DAILY_BUDGET_USD: saved.d, AI_MONTHLY_BUDGET_USD: saved.m, AI_KILL_SWITCH: saved.k });
  await db.execute(sql`DELETE FROM spend_ledger`);
});

test("a zero estimate at exactly the limit is refused; an exact fit is allowed", async () => {
  env.AI_KILL_SWITCH = false;
  env.AI_DAILY_BUDGET_USD = 10;
  env.AI_MONTHLY_BUDGET_USD = 100;
  await db.execute(sql`INSERT INTO spend_ledger (id, amount_usd) VALUES (${randomUUID()}, 9)`);
  await reserveAiSpend(1); // 9 + 1 == 10: fits exactly
  await assert.rejects(reserveAiSpend(0), (e: any) => e.code === "TOO_MANY_REQUESTS");
  await assert.rejects(reserveAiSpend(0.01), (e: any) => e.code === "TOO_MANY_REQUESTS");
});

test("an engine part reserves several model calls' worth", () => {
  assert.equal(ENGINE_CALLS_PER_PART, 3);
});
