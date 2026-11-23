import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { withTx } from "../db/tx.ts";
import { generatePath, lessonWriteState } from "../ai/service.ts";
import { isSafe } from "../safety/moderation.ts";
import { catalogueName, edgesFor, knownCatalogue, unmetPrerequisites } from "./catalogue.ts";
import { TRPCError } from "@trpc/server";
import { lessonDone, lessonTotal, listed, myUser, notFound, Origin, pathCards, PathListItem, Slug, visibleCourse } from "./shared.ts";

const Lesson = z.object({
  slug: z.string(),
  title: z.string(),
  level: z.number(),
  done: z.number(),
  total: z.number(),
  kind: z.enum(["predict", "learn", "watch", "practice", "game-practice", "scrim"]),
  missingPrerequisites: z.array(z.string()).default([]),
  writeState: z.enum(["ready", "writing", "failed", "pending"]),
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

const courseGet = protectedProcedure.input(Slug).output(CourseDetail).query(async ({ ctx, input }) => {
      const me = ctx.learnerId;
      const {
        rows: [course],
      } = await db.execute<{ id: string; slug: string; title: string; description: string; origin: z.infer<typeof Origin>; config: unknown }>(sql`
        SELECT w.id, w.slug, w.title, w.description, w.origin, w.config FROM worlds w
        WHERE w.slug = ${input.slug} AND ${visibleCourse(me)}`);
      if (!course) throw notFound("Course not found");

      const { rows: lessonRows } = await db.execute<Omit<z.infer<typeof Lesson>, "writeState" | "missingPrerequisites"> & { id: string; written: boolean; concepts: string[] }>(sql`
        SELECT l.id, l.slug, l.title, l.level, l.kind, l.concepts, ${lessonDone(me)} AS done, ${lessonTotal} AS total,
          (l.current_version_id IS NOT NULL) AS written
        FROM lessons l
        WHERE l.world_id = ${course.id} AND ${listed}
        ORDER BY l.level, l.position, l.id`);
      const courseConcepts = new Set(lessonRows.flatMap((l) => l.concepts.map((c) => c.trim().toLowerCase())));
      const edges = edgesFor(course.config, courseConcepts);
      const pKnown = edges.length ? await knownCatalogue(me) : new Map<string, number>();
      const lessons = lessonRows.map(({ id, written, concepts, ...lesson }) => ({
        ...lesson,
        writeState: lessonWriteState(id, written),
        missingPrerequisites: unmetPrerequisites(concepts.map((c) => c.trim().toLowerCase()), courseConcepts, edges, pKnown)
          .map((slug) => catalogueName(slug) ?? slug),
      }));
      return { slug: course.slug, title: course.title, description: course.description, origin: course.origin, lessons };
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

const PUBLISH_REFUSAL = "This path can't be published right now: it couldn't be cleared by our safety check.";
const MODERATION_CHUNK = 8000;
const publish = protectedProcedure
  .input(Slug)
  .output(z.void())
  .mutation(({ ctx, input }) => withTx(async (tx) => {
    const { rows: [path] } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM paths
      WHERE slug = ${input.slug} AND owner_id = ${myUser(ctx.learnerId)}
      FOR UPDATE`);
    if (!path) throw notFound("Path not found");

    const ownedWorlds = sql`
      SELECT w.id FROM worlds w
      JOIN path_courses pc ON pc.world_id = w.id
      JOIN paths p ON p.id = pc.path_id
      WHERE p.id = ${path.id} AND w.owner_id = p.owner_id`;
    await tx.execute(sql`
      SELECT id FROM lessons WHERE world_id IN (${ownedWorlds}) ORDER BY id FOR UPDATE`);

    const { rows: pending } = await tx.execute<{ text: string }>(sql`
      SELECT concat_ws(E'\n', p.title, p.tagline, w.title, w.description, l.title, v.content::text,
        (SELECT string_agg(concat_ws(' ', s.public::text, s.secret::text), E'\n' ORDER BY s.idx)
         FROM steps s WHERE s.lesson_version_id = v.id)) AS text
      FROM paths p
      LEFT JOIN path_courses pc ON pc.path_id = p.id
      LEFT JOIN worlds w ON w.id = pc.world_id AND w.owner_id = p.owner_id
      LEFT JOIN lessons l ON l.world_id = w.id
      LEFT JOIN lesson_versions v ON v.id = l.current_version_id
      WHERE p.id = ${path.id}`);
    const body = pending.map((row) => row.text).join("\n");
    for (let offset = 0; offset < body.length; offset += MODERATION_CHUNK) {
      if (!(await isSafe(body.slice(offset, offset + MODERATION_CHUNK)))) {
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
  .output(z.object({ slug: z.string(), firstCourseSlug: z.string() }))
  .mutation(({ ctx, input }) => generatePath(ctx.learnerId, input.prompt));

export const pathsRouter = router({ list: pathList, enroll, publish, generate });
export const coursesRouter = router({ get: courseGet });
