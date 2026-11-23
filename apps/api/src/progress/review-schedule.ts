import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";

export const REVIEW_DAYS = [1, 3, 7, 14, 30] as const;

export async function recordReviewEvidence(
  tx: Db,
  learnerId: string,
  updates: { conceptId: string; pNext: number }[],
  correct: boolean,
) {
  for (const { conceptId } of updates) {
    await tx.execute(sql`
      INSERT INTO review_schedule (learner_id, concept_id, due_at)
      VALUES (${learnerId}, ${conceptId}, now() + ${correct ? REVIEW_DAYS[0] : 0} * interval '1 day')
      ON CONFLICT (learner_id, concept_id) DO UPDATE
        SET due_at = LEAST(review_schedule.due_at, EXCLUDED.due_at), stage = 0
        WHERE ${!correct}`);
  }
}
