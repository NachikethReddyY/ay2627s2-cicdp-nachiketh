import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { db } from "../db/client.ts";
import { playableLesson, userOfLearner, visibleWorld } from "../access.ts";

export const notFound = (message: string) => new TRPCError({ code: "NOT_FOUND", message });
export const Origin = z.enum(["official", "community", "ai"]);
export const PathCard = z.object({
  slug: z.string(),
  title: z.string(),
  tagline: z.string(),
  origin: Origin,
  courseCount: z.number(),
  learners: z.number(),
});

export const Slug = z.object({ slug: z.string().regex(/^[\w-]{1,64}$/) });

export const lessonTotal = sql`(CASE WHEN l.kind = 'predict'
  THEN (SELECT count(*) FROM steps s WHERE s.lesson_version_id = l.current_version_id)::int ELSE 1 END)`;
const WIN_PREFIX = "md5:";
export const gameWinKey = (hash: string) => `${WIN_PREFIX}${hash}`;

export const gameBlockKeys = (content: SQL) => sql`(SELECT b.value->>'id' AS block_id, md5((b.value->'props')::text) AS hash, b.ord
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${content}->'doc'->'blocks') = 'array'
    THEN ${content}->'doc'->'blocks' ELSE '[]'::jsonb END) WITH ORDINALITY b(value, ord)
  WHERE b.value->>'type' = 'game')`;

export const gameWins = sql`(SELECT w.learner_id, w.lesson_id, w.hash, min(w.created_at) AS created_at FROM (
  SELECT gc.learner_id, gc.lesson_id, substr(gc.block_id, ${WIN_PREFIX.length + 1}) AS hash, gc.created_at
  FROM game_completions gc WHERE gc.block_id LIKE ${`${WIN_PREFIX}%`}
  UNION ALL
  SELECT gc.learner_id, gc.lesson_id,
    COALESCE((SELECT k.hash FROM lesson_versions v1 CROSS JOIN LATERAL ${gameBlockKeys(sql`v1.content`)} k
      WHERE v1.lesson_id = gc.lesson_id AND v1.version = gc.part_idx + 1 AND k.block_id = gc.block_id
      ORDER BY k.ord LIMIT 1), 'id:' || gc.block_id) AS hash,
    gc.created_at
  FROM game_completions gc WHERE gc.block_id NOT LIKE ${`${WIN_PREFIX}%`}) w
  GROUP BY w.learner_id, w.lesson_id, w.hash)`;

export const everyGameWon = (me: string) => sql`(SELECT count(*) > 0 AND count(*) = count(gw.hash)
  FROM (SELECT DISTINCT k.hash
    FROM lesson_versions v CROSS JOIN LATERAL ${gameBlockKeys(sql`v.content`)} k
    WHERE v.id = l.current_version_id) blocks
  LEFT JOIN ${gameWins} gw ON gw.learner_id = ${me} AND gw.lesson_id = l.id AND gw.hash = blocks.hash)`;
export const lessonDone = (me: string) => sql`(CASE WHEN l.kind = 'predict'
  THEN (SELECT count(*) FROM steps s JOIN step_progress sp ON sp.step_id = s.id
    WHERE s.lesson_version_id = l.current_version_id AND sp.learner_id = ${me}
      AND sp.state = 'revealed'
      AND (EXISTS (SELECT 1 FROM attempts a
        WHERE a.step_id = s.id AND a.learner_id = ${me} AND a.observed AND a.kind <> 'skip')
        OR (EXISTS (SELECT 1 FROM attempts skipped
          WHERE skipped.step_id = s.id AND skipped.learner_id = ${me} AND skipped.observed AND skipped.kind = 'skip')
          AND EXISTS (SELECT 1 FROM attempts answered
            WHERE answered.step_id = s.id AND answered.learner_id = ${me} AND answered.kind <> 'skip'))))::int
  WHEN l.kind = 'game-practice' THEN (CASE WHEN ${everyGameWon(me)} THEN 1 ELSE 0 END)
  ELSE (SELECT count(*) FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me})::int END)`;
export const lastActive = (me: string) => sql`GREATEST(
  (SELECT max(sp.updated_at) FROM steps s JOIN step_progress sp ON sp.step_id = s.id
    WHERE s.lesson_version_id = l.current_version_id AND sp.learner_id = ${me}),
  (SELECT pc.completed_at FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me}))`;
export const complete = (l: { done: number; total: number }) => l.total > 0 && l.done >= l.total;
export const listed = playableLesson();
export const visibleCourse = (me: string) => visibleWorld(userOfLearner(me));
export const myUser = userOfLearner;

export const PathListItem = PathCard.extend({
  enrolled: z.boolean(),
  visibility: z.enum(["private", "public"]),
  courses: z.array(z.object({ slug: z.string(), title: z.string() })),
});

export async function pathCards(me: string, where: SQL, order: SQL, limit: number) {
  const { rows } = await db.execute<z.infer<typeof PathListItem>>(sql`
    SELECT p.slug, p.title, p.tagline, p.origin, p.visibility,
      (SELECT count(*) FROM path_courses pc JOIN worlds w ON w.id = pc.world_id
        WHERE pc.path_id = p.id AND ${visibleCourse(me)})::int AS "courseCount",
      (SELECT count(*) FROM enrollments e WHERE e.path_id = p.id)::int AS learners,
      EXISTS (SELECT 1 FROM enrollments e WHERE e.path_id = p.id AND e.learner_id = ${me}) AS enrolled,
      (SELECT COALESCE(json_agg(json_build_object('slug', w.slug, 'title', w.title) ORDER BY pc.position), '[]')
        FROM path_courses pc JOIN worlds w ON w.id = pc.world_id WHERE pc.path_id = p.id AND ${visibleCourse(me)}) AS courses
    FROM paths p
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${limit}`);
  return rows;
}
