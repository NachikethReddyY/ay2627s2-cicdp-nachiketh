import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { lessonRef, meUser, visibleWorld } from "../access.ts";

/** What a checked run is judged against, and how a pass is saved. */
export type PracticeCheck = { expected: string; record: () => Promise<void> };

/**
 * The check for a published practice lesson the learner can see, or null for any other lesson.
 * The expected output is read now, so a lesson edited during the run does not change the answer.
 */
export async function practiceCheck(learnerId: string, lessonId: string): Promise<PracticeCheck | null> {
  const {
    rows: [lesson],
  } = await db.execute<{ id: string; expected: string | null }>(sql`
    SELECT l.id, v.content->>'expectedOutput' AS expected FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(lessonId)}
      AND l.status = 'published'
      AND l.kind = 'practice'
      AND v.content->>'kind' = 'practice'
      AND ${visibleWorld(meUser)}`);
  if (!lesson || lesson.expected === null) return null;
  return {
    expected: lesson.expected,
    record: async () => {
      await db.execute(sql`
        INSERT INTO part_completions (learner_id, lesson_id) VALUES (${learnerId}, ${lesson.id})
        ON CONFLICT DO NOTHING`);
    },
  };
}
