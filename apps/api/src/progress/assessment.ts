import { sql } from "drizzle-orm";
import { playableLesson } from "../access.ts";
import { db } from "../db/client.ts";
import { lessonDone, lessonTotal } from "./shared.ts";

export async function assessmentDue(learnerId: string, worldId: string) {
  const { rows } = await db.execute<{
    slug: string; title: string; assessment: "pre" | "post" | null; done: number; total: number; answered: boolean;
  }>(sql`
    SELECT l.slug, l.title, l.assessment, ${lessonDone(learnerId)} AS done, ${lessonTotal} AS total,
      EXISTS (
        SELECT 1 FROM steps s JOIN attempts a ON a.step_id = s.id
        WHERE s.lesson_version_id = l.current_version_id AND a.learner_id = ${learnerId} AND a.observed
      ) OR ${lessonDone(learnerId)} > 0 AS answered
    FROM lessons l WHERE l.world_id = ${worldId} AND ${playableLesson()}`);
  const course = rows.filter((l) => l.assessment === null);
  const phase = course.some((l) => l.answered)
    ? (course.every((l) => l.total > 0 && l.done >= l.total) ? "post" : null)
    : "pre";
  return phase ? rows.find((l) => l.assessment === phase && l.done < l.total) : undefined;
}

export async function learning(learnerId: string, worldId: string) {
  const { rows } = await db.execute<{ slug: string; pre: boolean | null; post: boolean | null }>(sql`
    SELECT s.secret->'concepts'->>0 AS slug,
      bool_or(a.correct IS TRUE AND a.hints_used = 0) FILTER (WHERE l.assessment = 'pre') AS pre,
      bool_or(a.correct IS TRUE AND a.hints_used = 0) FILTER (WHERE l.assessment = 'post') AS post
    FROM lessons l JOIN steps s ON s.lesson_version_id = l.current_version_id AND s.idx >= 0
    LEFT JOIN attempts a ON a.step_id = s.id AND a.learner_id = ${learnerId} AND a.observed
    WHERE l.world_id = ${worldId} AND l.assessment IS NOT NULL AND a.id IS NOT NULL
    GROUP BY 1 ORDER BY 1`);
  return rows;
}
