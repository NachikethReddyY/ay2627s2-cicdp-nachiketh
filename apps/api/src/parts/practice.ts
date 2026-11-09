import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { lessonRef, meUser, visibleWorld } from "../access.ts";
import { parsePractice, type Practice } from "./practice-schema.ts";

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
    record: () => recordCompletion(learnerId, lesson.id),
  };
}

/** What a multi-test Check runs: the lesson's tests, or null for a lesson the learner cannot see, a non-practice lesson or invalid content. */
export async function practiceTests(learnerId: string, lessonId: string): Promise<{ lessonId: string; practice: Practice } | null> {
  const {
    rows: [lesson],
  } = await db.execute<{ id: string; content: unknown }>(sql`
    SELECT l.id, v.content FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(lessonId)}
      AND l.status = 'published'
      AND l.kind = 'practice'
      AND v.content->>'kind' = 'practice'
      AND ${visibleWorld(meUser)}`);
  const practice = lesson ? parsePractice(lesson.content) : null;
  return lesson && practice ? { lessonId: lesson.id, practice } : null;
}

/** Saves a lesson's completion; saving it twice is a no-op. */
export async function recordCompletion(learnerId: string, lessonId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO part_completions (learner_id, lesson_id) VALUES (${learnerId}, ${lessonId})
    ON CONFLICT DO NOTHING`);
}
