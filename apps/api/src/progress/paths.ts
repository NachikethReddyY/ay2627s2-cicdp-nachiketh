import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { generatePath } from "../ai/service.ts";
import { isSafe } from "../safety/moderation.ts";
import { TRPCError } from "@trpc/server";
import { complete, lessonDone, lessonTotal, listed, myUser, notFound, Origin, PathCard, Slug, visibleCourse } from "./shared.ts";

const Lesson = z.object({
  slug: z.string(),
  title: z.string(),
  level: z.number(),
  done: z.number(),
  total: z.number(),
  kind: z.enum(["predict", "learn", "watch", "practice", "game-practice"]),
});
const CourseDetail = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  origin: Origin,
  lessons: z.array(Lesson),
});
const PathListItem = PathCard.extend({
  enrolled: z.boolean(),
  visibility: z.enum(["private", "public"]),
  courses: z.array(z.object({ slug: z.string(), title: z.string() })),
});
const PathDetail = z.object({
  slug: z.string(),
  title: z.string(),
  tagline: z.string(),
  origin: Origin,
  visibility: z.enum(["private", "public"]),
  mine: z.boolean(),
  enrolled: z.boolean(),
  courses: z.array(
    z.object({ slug: z.string(), title: z.string(), description: z.string(), lessonsDone: z.number(), lessonsTotal: z.number() }),
  ),
});

const enroll = protectedProcedure.input(Slug).output(z.void()).mutation(async ({ ctx, input }) => {
      // Private paths are enrollable only by their owner.
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

  // Visible = public, or owned by the caller.
const courseGet = protectedProcedure.input(Slug).output(CourseDetail).query(async ({ ctx, input }) => {
      const me = ctx.learnerId;
      const {
        rows: [course],
      } = await db.execute<{ id: string; slug: string; title: string; description: string; origin: z.infer<typeof Origin> }>(sql`
        SELECT w.id, w.slug, w.title, w.description, w.origin FROM worlds w
        WHERE w.slug = ${input.slug} AND ${visibleCourse(me)}`);
      if (!course) throw notFound("Course not found");

      const { rows: lessonRows } = await db.execute<z.infer<typeof Lesson>>(sql`
        SELECT l.slug, l.title, l.level, l.kind, ${lessonDone(me)} AS done, ${lessonTotal} AS total
        FROM lessons l
        WHERE l.world_id = ${course.id} AND ${listed}
        ORDER BY l.level, l.position, l.id`);
      return { slug: course.slug, title: course.title, description: course.description, origin: course.origin, lessons: lessonRows };
  });

  // scope: official = public official paths, community = public other paths, mine = paths I own.
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
      // Escape LIKE wildcards so q matches literally.
      const search = q ? sql`AND p.title ILIKE ${`%${q.replace(/[\\%_]/g, "\\$&")}%`}` : sql``;
      const { rows } = await db.execute<z.infer<typeof PathListItem>>(sql`
        SELECT p.slug, p.title, p.tagline, p.origin, p.visibility,
          (SELECT count(*) FROM path_courses pc JOIN worlds w ON w.id = pc.world_id
            WHERE pc.path_id = p.id AND ${visibleCourse(me)})::int AS "courseCount",
          (SELECT count(*) FROM enrollments e WHERE e.path_id = p.id)::int AS learners,
          EXISTS (SELECT 1 FROM enrollments e WHERE e.path_id = p.id AND e.learner_id = ${me}) AS enrolled,
          (SELECT COALESCE(json_agg(json_build_object('slug', w.slug, 'title', w.title) ORDER BY pc.position), '[]')
            FROM path_courses pc JOIN worlds w ON w.id = pc.world_id WHERE pc.path_id = p.id AND ${visibleCourse(me)}) AS courses
        FROM paths p
        WHERE ${scoped} ${search}
        ORDER BY learners DESC, p.created_at DESC
        LIMIT 50`);
      return rows;
  });

const pathGet = protectedProcedure.input(Slug).output(PathDetail).query(async ({ ctx, input }) => {
      const me = ctx.learnerId;
      const {
        rows: [path],
      } = await db.execute<{ id: string; slug: string; title: string; tagline: string; origin: z.infer<typeof Origin>; visibility: "private" | "public"; mine: boolean; enrolled: boolean }>(sql`
        SELECT p.id, p.slug, p.title, p.tagline, p.origin, p.visibility,
          COALESCE(p.owner_id = ${myUser(me)}, false) AS mine,
          EXISTS (SELECT 1 FROM enrollments e WHERE e.path_id = p.id AND e.learner_id = ${me}) AS enrolled
        FROM paths p
        WHERE p.slug = ${input.slug} AND (p.visibility = 'public' OR p.owner_id = ${myUser(me)})`);
      if (!path) throw notFound("Path not found");

      const { rows } = await db.execute<{
        course_slug: string;
        course_title: string;
        description: string;
        lesson_id: string | null;
        done: number;
        total: number;
      }>(sql`
        SELECT w.slug AS course_slug, w.title AS course_title, w.description,
          l.id AS lesson_id, ${lessonDone(me)} AS done, ${lessonTotal} AS total
        FROM path_courses pc
        JOIN worlds w ON w.id = pc.world_id
        LEFT JOIN lessons l ON l.world_id = w.id AND ${listed}
        WHERE pc.path_id = ${path.id} AND ${visibleCourse(me)}
        ORDER BY pc.position, l.level, l.position, l.id`);

      const courses = new Map<string, { slug: string; title: string; description: string; lessonsDone: number; lessonsTotal: number }>();
      for (const row of rows) {
        let c = courses.get(row.course_slug);
        if (!c) {
          c = { slug: row.course_slug, title: row.course_title, description: row.description, lessonsDone: 0, lessonsTotal: 0 };
          courses.set(row.course_slug, c);
        }
        if (row.lesson_id) {
          c.lessonsTotal++;
          if (complete(row)) c.lessonsDone++;
        }
      }
      return {
        slug: path.slug,
        title: path.title,
        tagline: path.tagline,
        origin: path.origin,
        visibility: path.visibility,
        mine: path.mine,
        enrolled: path.enrolled,
        courses: [...courses.values()],
      };
  });

// Owner only. Publishes the path and the courses it contains that the same user owns.
// Publishing makes content visible to everyone, so unlike generation (which fails open) it fails closed:
// the text is moderated first, and if moderation is unavailable or flags it, nothing is published.
const PUBLISH_REFUSAL = "This path can't be published right now: it couldn't be cleared by our safety check.";
const MODERATION_CHUNK = 8000;
const publish = protectedProcedure
  .input(Slug)
  .output(z.void())
  .mutation(async ({ ctx, input }) => {
    const { rows: pending } = await db.execute<{ text: string }>(sql`
      SELECT concat_ws(E'\n', p.title, p.tagline, w.title, w.description, l.title, v.content::text) AS text
      FROM paths p
      LEFT JOIN path_courses pc ON pc.path_id = p.id
      LEFT JOIN worlds w ON w.id = pc.world_id AND w.owner_id = p.owner_id
      LEFT JOIN lessons l ON l.world_id = w.id
      LEFT JOIN lesson_versions v ON v.id = l.current_version_id
      WHERE p.slug = ${input.slug} AND p.owner_id = ${myUser(ctx.learnerId)}`);
    if (pending.length === 0) throw notFound("Path not found");
    const body = pending.map((r) => r.text).join("\n");
    for (let i = 0; i < body.length; i += MODERATION_CHUNK) {
      // failOpen is false here on purpose.
      if (!(await isSafe(body.slice(i, i + MODERATION_CHUNK)))) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: PUBLISH_REFUSAL });
      }
    }

    const { rows } = await db.execute(sql`
      WITH me AS (SELECT user_id AS id FROM learners WHERE id = ${ctx.learnerId}),
      p AS (
        UPDATE paths SET visibility = 'public'
        WHERE slug = ${input.slug} AND owner_id = (SELECT id FROM me)
        RETURNING id
      ),
      w AS (
        UPDATE worlds SET visibility = 'public'
        WHERE owner_id = (SELECT id FROM me)
          AND id IN (SELECT world_id FROM path_courses WHERE path_id IN (SELECT id FROM p))
        RETURNING id
      )
      SELECT id FROM p`);
    if (rows.length === 0) throw notFound("Path not found");
  });

const generate = protectedProcedure
  .input(z.object({ prompt: z.string().trim().min(3).max(300) }))
  .output(z.object({ slug: z.string(), firstCourseSlug: z.string() }))
  .mutation(({ ctx, input }) => generatePath(ctx.learnerId, input.prompt));

export const pathsRouter = router({ list: pathList, get: pathGet, enroll, publish, generate });
export const coursesRouter = router({ get: courseGet });
