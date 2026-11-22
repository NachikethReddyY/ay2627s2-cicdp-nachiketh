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
const gameBlocks = (content: SQL) => sql`(SELECT b.value->>'id' AS id, b.value->'props' AS props
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${content}->'doc'->'blocks') = 'array'
    THEN ${content}->'doc'->'blocks' ELSE '[]'::jsonb END) b(value)
  WHERE b.value->>'type' = 'game')`;

const gameBlockWon = (learnerId: string, lessonId: SQL, version: SQL, blockId: SQL, props: SQL) => sql`EXISTS (
  WITH RECURSIVE revisions AS (
    SELECT history.version, row_number() OVER (ORDER BY history.version) AS position,
      ARRAY(SELECT game.id FROM ${gameBlocks(sql`history.content`)} game WHERE game.props = ${props}) AS ids
    FROM lesson_versions history
    WHERE history.lesson_id = ${lessonId} AND history.version <= ${version}
      AND (history.published_at IS NOT NULL OR history.version = ${version} OR EXISTS (
        SELECT 1 FROM game_completions gc WHERE gc.learner_id = ${learnerId}
          AND gc.lesson_id = history.lesson_id AND gc.part_idx = history.version - 1))
  ), wins AS (
    SELECT revision.position, gc.block_id
    FROM game_completions gc JOIN revisions revision ON revision.version = gc.part_idx + 1
    WHERE gc.learner_id = ${learnerId} AND gc.lesson_id = ${lessonId} AND gc.block_id = ANY(revision.ids)
    UNION
    SELECT next.position, CASE
      WHEN wins.block_id <> ALL(next.ids)
        AND previous.ids = ARRAY[wins.block_id] AND cardinality(next.ids) = 1 THEN next.ids[1]
      ELSE wins.block_id END
    FROM wins
    JOIN revisions previous ON previous.position = wins.position
    JOIN revisions next ON next.position = wins.position + 1
  )
  SELECT 1 FROM wins JOIN revisions revision ON revision.position = wins.position
  WHERE revision.version = ${version} AND wins.block_id = ${blockId})`;

export const currentGameBlockWon = (learnerId: string, lessonId: string, versionId: string, blockId: string) => sql`EXISTS (
  SELECT 1 FROM lesson_versions v CROSS JOIN LATERAL ${gameBlocks(sql`v.content`)} b
  WHERE v.id = ${versionId} AND b.id = ${blockId}
    AND ${gameBlockWon(learnerId, sql`${lessonId}`, sql`v.version`, sql`b.id`, sql`b.props`)})`;

export const everyGameWon = (learnerId: string) => sql`(SELECT coalesce(bool_and(
  ${gameBlockWon(learnerId, sql`l.id`, sql`v.version`, sql`b.id`, sql`b.props`)}), false)
  FROM lesson_versions v CROSS JOIN LATERAL ${gameBlocks(sql`v.content`)} b
  WHERE v.id = l.current_version_id)`;
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
  WHEN l.kind = 'scrim'
  THEN (SELECT count(*) FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me}
    AND NOT EXISTS (SELECT 1 FROM lesson_versions v
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.content->'segments') = 'array' THEN v.content->'segments' ELSE '[]'::jsonb END) segment
      WHERE v.id = l.current_version_id AND jsonb_typeof(segment->'gate') = 'number'
        AND NOT EXISTS (SELECT 1 FROM steps s JOIN step_progress sp ON sp.step_id = s.id AND sp.learner_id = ${me}
          WHERE s.lesson_version_id = v.id AND s.idx = (segment->>'gate')::int AND sp.state = 'revealed')))::int
  ELSE (SELECT count(*) FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me})::int END)`;
export const lastActive = (me: string) => sql`GREATEST(
  (SELECT max(sp.updated_at) FROM steps s JOIN step_progress sp ON sp.step_id = s.id
    WHERE s.lesson_version_id = l.current_version_id AND sp.learner_id = ${me}),
  (SELECT pc.completed_at FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me}),
  (SELECT max(gc.created_at) FROM game_completions gc WHERE gc.lesson_id = l.id AND gc.learner_id = ${me}))`;
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
