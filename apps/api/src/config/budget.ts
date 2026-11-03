import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client.ts";
import { env } from "../env.ts";

export async function reserveAiSpend(estimatedUsd = 0) {
  if (env.AI_KILL_SWITCH) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is temporarily unavailable" });
  const { rows: [totals] } = await db.execute<{ daily: string; monthly: string }>(sql`SELECT
    COALESCE(sum(amount_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS daily,
    COALESCE(sum(amount_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::text AS monthly FROM spend_ledger`);
  // A budget of 0 means no limit.
  const over = (spent: number, limit: number) => limit > 0 && spent + estimatedUsd > limit;
  if (over(Number(totals!.daily), env.AI_DAILY_BUDGET_USD) || over(Number(totals!.monthly), env.AI_MONTHLY_BUDGET_USD))
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI budget limit reached" });
  await db.execute(sql`INSERT INTO spend_ledger (id, amount_usd) VALUES (gen_random_uuid()::text, ${estimatedUsd})`);
}
