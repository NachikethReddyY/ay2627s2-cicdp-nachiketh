import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { withTx } from "../db/tx.ts";
import { env } from "../env.ts";

/** An engine lesson part can make up to three model calls (see ENGINE_TIMEOUT_MS), so its reservation is this many estimates. */
export const ENGINE_CALLS_PER_PART = 3;

export async function reserveAiSpend(estimatedUsd = 0) {
  if (env.AI_KILL_SWITCH) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is temporarily unavailable" });
  // One lock + read + insert transaction, so parallel reservations cannot all pass the limit.
  await withTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ai_spend'))`);
    const { rows: [totals] } = await tx.execute<{ daily: string; monthly: string }>(sql`SELECT
      COALESCE(sum(amount_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)::text AS daily,
      COALESCE(sum(amount_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::text AS monthly FROM spend_ledger`);
    // A budget of 0 means no limit.
    // At or past the limit nothing more is allowed, even a zero estimate; otherwise the estimate must fit.
    const over = (spent: number, limit: number) => limit > 0 && (spent >= limit || spent + estimatedUsd > limit);
    if (over(Number(totals!.daily), env.AI_DAILY_BUDGET_USD) || over(Number(totals!.monthly), env.AI_MONTHLY_BUDGET_USD))
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI budget limit reached" });
    await tx.execute(sql`INSERT INTO spend_ledger (id, amount_usd) VALUES (gen_random_uuid()::text, ${estimatedUsd})`);
  });
}
