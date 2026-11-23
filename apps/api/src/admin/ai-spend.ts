import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.ts";
import { aiCallSpend } from "../db/schema.ts";

export const tokenCount = z.int().min(0).max(2_147_483_647);
export const spendAmount = z.number().min(0).lt(1e12);
const usageHeader = z.array(z.object({
  model: z.string().min(1).max(240),
  prompt_tokens: tokenCount,
  completion_tokens: tokenCount,
  estimated_usd: spendAmount.nullable().optional().catch(null),
})).max(32);

export async function recordEngineCallSpend(header: string | null) {
  if (!header || header === "[]") return;
  try {
    const usage = usageHeader.parse(JSON.parse(header));
    if (usage.length === 0) return;
    await db.insert(aiCallSpend).values(usage.map(({ prompt_tokens, completion_tokens, estimated_usd }) => ({
      promptTokens: prompt_tokens,
      completionTokens: completion_tokens,
      estimatedUsd: estimated_usd?.toFixed(12) ?? null,
    })));
  } catch {
    console.warn("Could not record AI call spend");
  }
}

export async function recordMediaCallSpend(promptTokens: number, completionTokens: number, cost: number | null) {
  try {
    await db.insert(aiCallSpend).values({ promptTokens, completionTokens, estimatedUsd: cost?.toFixed(12) ?? null });
  } catch {
    console.warn("Could not record AI call spend");
  }
}

type SpendTotals = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  estimatedUsd: number;
  unpricedCalls: number;
};

export async function aiSpendByDay() {
  const { rows } = await db.execute<SpendTotals & { day: string | null }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') AS day,
      count(*)::float8 AS calls,
      coalesce(sum(prompt_tokens), 0)::float8 AS "promptTokens",
      coalesce(sum(completion_tokens), 0)::float8 AS "completionTokens",
      coalesce(sum(estimated_usd), 0)::float8 AS "estimatedUsd",
      count(*) FILTER (WHERE estimated_usd IS NULL)::float8 AS "unpricedCalls"
    FROM ai_call_spend
    WHERE day BETWEEN date_trunc('month', now() AT TIME ZONE 'UTC')::date AND (now() AT TIME ZONE 'UTC')::date
    GROUP BY GROUPING SETS ((day), ())
    ORDER BY 1 DESC NULLS FIRST`);
  const [{ day: _month, ...monthToDate }, ...days] = rows;
  return { monthToDate, days: days.flatMap(({ day, ...totals }) => day === null ? [] : [{ day, ...totals }]) };
}
