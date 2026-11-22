import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { lessonRef, meUser, playableLesson, visibleWorld } from "../access.ts";
import { parsePractice, type Practice } from "./practice-schema.ts";

export function practiceOf(content: unknown): Practice | null {
  if (typeof content !== "object" || content === null || !("kind" in content)) return null;
  if (content.kind === "practice") return parsePractice(content);
  if (content.kind === "scrim" && "lab" in content) return parsePractice(content.lab);
  return null;
}

export type PracticeCheck = { expected: string; record: () => Promise<void> };

export async function practiceCheck(learnerId: string, lessonId: string): Promise<PracticeCheck | null> {
  const {
    rows: [lesson],
  } = await db.execute<{ id: string; expected: string | null }>(sql`
    SELECT l.id, COALESCE(v.content->>'expectedOutput', v.content->'lab'->>'expectedOutput') AS expected FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(lessonId)}
      AND ${playableLesson()}
      AND l.kind IN ('practice', 'scrim')
      AND v.content->>'kind' = l.kind
      AND (l.kind = 'practice' OR v.content->'lab'->'tests' IS NULL)
      AND ${visibleWorld(meUser)}`);
  if (!lesson || lesson.expected === null) return null;
  return {
    expected: lesson.expected,
    record: () => recordCompletion(learnerId, lesson.id),
  };
}

export async function practiceTests(learnerId: string, lessonId: string): Promise<{ lessonId: string; practice: Practice } | null> {
  const {
    rows: [lesson],
  } = await db.execute<{ id: string; content: unknown }>(sql`
    SELECT l.id, v.content FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(lessonId)}
      AND ${playableLesson()}
      AND l.kind IN ('practice', 'scrim')
      AND v.content->>'kind' = l.kind
      AND ${visibleWorld(meUser)}`);
  const practice = lesson ? practiceOf(lesson.content) : null;
  return lesson && practice ? { lessonId: lesson.id, practice } : null;
}

export async function recordCompletion(learnerId: string, lessonId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO part_completions (learner_id, lesson_id) VALUES (${learnerId}, ${lessonId})
    ON CONFLICT DO NOTHING`);
}
