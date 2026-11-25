import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { readyPath } from "../access.ts";
import { withTx } from "../db/tx.ts";
import { generatePath, lessonWriteState } from "../ai/service.ts";
import { checkModeration } from "../safety/moderation.ts";
import { catalogueName, edgesFor, knownCatalogue, unmetPrerequisites } from "./catalogue.ts";
import { TRPCError } from "@trpc/server";
import { lessonDone, lessonTotal, listedForRoadmap, myUser, notFound, Origin, pathCards, PathListItem, Slug, visibleCourse } from "./shared.ts";

const WriteState = z.enum(["ready", "writing", "failed", "pending"]);
const Lesson = z.object({
  slug: z.string(),
  title: z.string(),
  level: z.number(),
  done: z.number(),
  total: z.number(),
  kind: z.enum(["predict", "learn", "watch", "practice", "game-practice", "scrim"]),
  missingPrerequisites: z.array(z.string()).default([]),
  writeState: WriteState,
});
const CourseDetail = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  origin: Origin,
  lessons: z.array(Lesson),
});
const enroll = protectedProcedure.input(Slug).output(z.void()).mutation(async ({ ctx, input }) => {
      const { rows } = await db.execute(sql`
        INSERT INTO enrollments (learner_id, path_id)
        SELECT l.id, p.id FROM paths p, learners l
        WHERE p.slug = ${input.slug} AND l.id = ${ctx.learnerId}
          AND (p.visibility = 'public' OR p.owner_id = l.user_id)
        ON CONFLICT DO NOTHING
        RETURNING 1`);
      if (rows.length === 0) {
        const { rows: found } = await db.execute(sql`
          SELECT 1 FROM paths p JOIN learners l ON l.id = ${ctx.learnerId}
          WHERE p.slug = ${input.slug} AND (p.visibility = 'public' OR p.owner_id = l.user_id)`);
        if (found.length === 0) {
          throw notFound("Path not found");
        }
      }
  });

type LessonRow = Omit<z.infer<typeof Lesson>, "writeState" | "missingPrerequisites"> & {
  id: string;
  written: boolean;
  concepts: string[];
  buildState: z.infer<typeof WriteState> | null;
};

const selectLesson = (me: string) => sql`
  SELECT l.id, l.slug, l.title, l.level, l.position, l.kind, l.concepts, ${lessonDone(me)} AS done, ${lessonTotal} AS total,
    (l.current_version_id IS NOT NULL) AS written, build.state AS "buildState"
  FROM lessons l LEFT JOIN path_build_jobs build ON build.lesson_id = l.id`;

function courseDetails(course: CourseRow, known: Map<string, number>) {
  const concepts = new Set(course.lessons.flatMap((l) => l.concepts.map((c) => c.trim().toLowerCase())));
  const edges = edgesFor(course.config, concepts);
  const lessons = course.lessons.map(({ id, written, concepts: tags, buildState, ...lesson }) => ({
    ...lesson,
    writeState: buildState ?? lessonWriteState(id, written),
    missingPrerequisites: unmetPrerequisites(tags.map((c) => c.trim().toLowerCase()), concepts, edges, known)
      .map((slug) => catalogueName(slug) ?? slug),
  }));
  return { slug: course.slug, title: course.title, description: course.description, origin: course.origin, lessons };
}

type CourseRow = Omit<z.infer<typeof CourseDetail>, "lessons"> & { config: unknown; lessons: LessonRow[] };

const selectCourse = (me: string) => sql`
  w.slug, w.title, w.description, w.origin, w.config,
  (SELECT coalesce(json_agg(lesson ORDER BY lesson.level, lesson.position, lesson.id), '[]')
    FROM (${selectLesson(me)}
      WHERE l.world_id = w.id AND ${listedForRoadmap}) lesson) AS lessons`;

const courseGet = protectedProcedure
  .input(Slug.extend({ path: Slug.shape.slug.optional() }))
  .output(CourseDetail.extend({ nextSection: z.string().nullable() }))
  .query(async ({ ctx, input }) => {
    const me = ctx.learnerId;
    const { rows: [course] } = await db.execute<CourseRow & { building: boolean }>(sql`
      SELECT ${selectCourse(me)}, EXISTS (
        SELECT 1 FROM path_courses pc WHERE pc.world_id = w.id AND NOT (${readyPath(sql`pc.path_id`)})) AS building
      FROM worlds w WHERE w.slug = ${input.slug} AND ${visibleCourse(me)}`);
    if (!course) throw notFound("Course not found");
    if (course.building) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This section opens when the full path is ready." });
    const [known, next] = await Promise.all([
      knownCatalogue(me),
      input.path ? db.execute<{ slug: string }>(sql`
        SELECT w.slug FROM paths p
        JOIN path_courses current_section ON current_section.path_id = p.id
        JOIN worlds current_world ON current_world.id = current_section.world_id
        JOIN path_courses next_section ON next_section.path_id = p.id
        JOIN worlds w ON w.id = next_section.world_id
        WHERE p.slug = ${input.path} AND (p.visibility = 'public' OR p.owner_id = ${myUser(me)})
          AND current_world.slug = ${input.slug} AND ${visibleCourse(me)}
          AND (next_section.position, next_section.world_id) > (current_section.position, current_section.world_id)
        ORDER BY next_section.position, next_section.world_id LIMIT 1`) : undefined,
    ]);
    return { ...courseDetails(course, known), nextSection: next?.rows[0]?.slug ?? null };
  });

const Roadmap = z.object({
  slug: z.string(),
  title: z.string(),
  tagline: z.string(),
  roadmap: z.object({
    startingPoint: z.string(),
    destination: z.string(),
    topics: z.array(z.object({ title: z.string(), outcome: z.string() })),
  }).nullable(),
  build: z.object({
    state: z.enum(["planning", "building", "ready", "failed", "refused"]),
    ready: z.number(),
    total: z.number(),
  }).nullable(),
  sections: z.array(CourseDetail),
});

type Build = NonNullable<z.infer<typeof Roadmap>["build"]>;

const pathGet = protectedProcedure.input(Slug).output(Roadmap).query(async ({ ctx, input }) => {
  const me = ctx.learnerId;
  const { rows: [path] } = await db.execute<Omit<z.infer<typeof Roadmap>, "sections" | "build"> & { id: string; build: Build | null }>(sql`
    SELECT p.id, p.slug, p.title, p.tagline, p.roadmap,
      (SELECT json_build_object(
        'state', CASE WHEN bool_or(j.state = 'refused') THEN 'refused'
          WHEN bool_or(j.state = 'failed') THEN 'failed'
          WHEN bool_or(j.lesson_id IS NULL AND j.state <> 'ready') THEN 'planning'
          WHEN bool_and(j.state = 'ready') THEN 'ready' ELSE 'building' END,
        'ready', count(*) FILTER (WHERE j.lesson_id IS NOT NULL AND j.state = 'ready'),
        'total', count(j.lesson_id)) FROM path_build_jobs j WHERE j.path_id = p.id HAVING count(*) > 0) AS build
    FROM paths p WHERE p.slug = ${input.slug} AND (p.visibility = 'public' OR p.owner_id = ${myUser(me)})`);
  if (!path) throw notFound("Path not found");
  const { rows } = await db.execute<CourseRow>(sql`
    SELECT ${selectCourse(me)} FROM path_courses pc JOIN worlds w ON w.id = pc.world_id
    WHERE pc.path_id = ${path.id} AND ${visibleCourse(me)}
    ORDER BY pc.position, pc.world_id`);
  const known = rows.length ? await knownCatalogue(me) : new Map<string, number>();
  return { ...path, sections: rows.map((course) => courseDetails(course, known)) };
});

const retryBuild = protectedProcedure.input(Slug).output(z.void()).mutation(async ({ ctx, input }) => {
  const { rows: [path] } = await db.execute<{ id: string }>(sql`
    SELECT id FROM paths WHERE slug = ${input.slug} AND owner_id = ${myUser(ctx.learnerId)}`);
  if (!path) throw notFound("Path not found");
  await db.execute(sql`
    UPDATE path_build_jobs SET state = 'pending', attempts = 0, available_at = now()
    WHERE path_id = ${path.id} AND state = 'failed'`);
});

const pathList = protectedProcedure
  .input(
    z
      .object({
      scope: z.enum(["official", "community", "mine"]).default("official"),
      q: z.string().max(100).optional(),
    })
    .prefault({}),
  )
  .output(z.array(PathListItem))
  .query(async ({ ctx, input }) => {
      const me = ctx.learnerId;
      const { scope, q } = input;
      const scoped = {
        official: sql`p.visibility = 'public' AND p.origin = 'official'`,
        community: sql`p.visibility = 'public' AND p.origin <> 'official'`,
        mine: sql`p.owner_id = ${myUser(me)}`,
      }[scope];
      const search = q ? sql`AND p.title ILIKE ${`%${q.replace(/[\\%_]/g, "\\$&")}%`}` : sql``;
      return pathCards(me, sql`${scoped} ${search}`, sql`learners DESC, p.created_at DESC`, 50);
  });

const PUBLISH_UNAVAILABLE = "Publishing is unavailable because the automatic safety check couldn't run. Your path is still private.";
const PUBLISH_REFUSAL = "This path didn't pass the automatic safety check. It is still private.";
const MODERATION_CHUNK = 8000;
const publish = protectedProcedure
  .input(Slug)
  .output(z.void())
  .mutation(({ ctx, input }) => withTx(async (tx) => {
    const { rows: [path] } = await tx.execute<{ id: string; visibility: "public" | "private"; ready: boolean }>(sql`
      SELECT id, visibility, ${readyPath(sql`paths.id`)} AS ready FROM paths
      WHERE slug = ${input.slug} AND owner_id = ${myUser(ctx.learnerId)}
      FOR UPDATE`);
    if (!path) throw notFound("Path not found");
    if (path.visibility === "public") return;
    if (!path.ready) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Wait for the full path to finish building before publishing." });

    const ownedWorlds = sql`
      SELECT w.id FROM worlds w
      JOIN path_courses pc ON pc.world_id = w.id
      JOIN paths p ON p.id = pc.path_id
      WHERE p.id = ${path.id} AND w.owner_id = p.owner_id`;
    await tx.execute(sql`
      SELECT id FROM lessons WHERE world_id IN (${ownedWorlds}) ORDER BY id FOR UPDATE`);

    const { rows: pending } = await tx.execute<{ text: string }>(sql`
      SELECT concat_ws(E'\n', w.title, w.description, l.title, l.objective, v.content::text,
        (SELECT string_agg(concat_ws(' ', s.public::text, s.secret::text), E'\n' ORDER BY s.idx)
         FROM steps s WHERE s.lesson_version_id = v.id)) AS text
      FROM paths p
      LEFT JOIN path_courses pc ON pc.path_id = p.id
      LEFT JOIN worlds w ON w.id = pc.world_id AND w.owner_id = p.owner_id
      LEFT JOIN lessons l ON l.world_id = w.id
      LEFT JOIN lesson_versions v ON v.id = l.current_version_id
      WHERE p.id = ${path.id}`);
    const { rows: [metadata] } = await tx.execute<{ text: string }>(sql`
      SELECT concat_ws(E'\n', title, tagline, roadmap::text) AS text FROM paths WHERE id = ${path.id}`);
    const body = [metadata.text, ...pending.map((row) => row.text)].join("\n");
    for (let offset = 0; offset < body.length; offset += MODERATION_CHUNK) {
      const check = await checkModeration(body.slice(offset, offset + MODERATION_CHUNK));
      if (check.status === "unavailable") {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: PUBLISH_UNAVAILABLE });
      }
      if (check.status === "flagged") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: PUBLISH_REFUSAL });
      }
    }

    await tx.execute(sql`UPDATE paths SET visibility = 'public' WHERE id = ${path.id}`);
    await tx.execute(sql`UPDATE worlds SET visibility = 'public' WHERE id IN (${ownedWorlds})`);
    await tx.execute(sql`
      WITH published AS (
        UPDATE lessons SET status = 'published'
        WHERE world_id IN (${ownedWorlds}) AND source_kind = 'ai' AND status = 'draft'
        RETURNING current_version_id
      )
      UPDATE lesson_versions SET published_at = coalesce(published_at, now())
      WHERE id IN (SELECT current_version_id FROM published)`);
  }));

const generate = protectedProcedure
  .input(z.object({ prompt: z.string().trim().min(3).max(300) }))
  .output(z.object({ slug: z.string(), firstCourseSlug: z.string().optional() }))
  .mutation(({ ctx, input }) => generatePath(ctx.learnerId, input.prompt));

export const pathsRouter = router({ get: pathGet, retryBuild, list: pathList, enroll, publish, generate });
export const coursesRouter = router({ get: courseGet });
