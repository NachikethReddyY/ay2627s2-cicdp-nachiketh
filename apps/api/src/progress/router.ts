import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { generatePath } from "../ai/service.ts";
import { streak, week } from "./streak.ts";

const notFound = (message: string) => new TRPCError({ code: "NOT_FOUND", message });
const Origin = z.enum(["official", "community", "ai"]);
const Course = z.object({ slug: z.string(), title: z.string(), lessonsDone: z.number(), lessonsTotal: z.number() });
const PathCard = z.object({
  slug: z.string(),
  title: z.string(),
  tagline: z.string(),
  origin: Origin,
  courseCount: z.number(),
  learners: z.number(),
});
const Home = z.object({
  stats: z.object({
    xp: z.number(),
    todayXp: z.number(),
    dailyGoalXp: z.number(),
    streak: z.number(),
    week: z.array(z.object({ day: z.string(), solved: z.number() })),
  }),
  continue: z
    .object({
      path: z.object({ slug: z.string(), title: z.string() }),
      course: z.object({ slug: z.string(), title: z.string(), index: z.number(), count: z.number() }),
      lesson: z.object({ slug: z.string(), title: z.string(), level: z.number(), done: z.number(), total: z.number() }),
    })
    .nullable(),
  paths: z.array(
    z.object({ slug: z.string(), title: z.string(), tagline: z.string(), origin: Origin, courses: z.array(Course) }),
  ),
  official: z.array(PathCard),
  community: z.array(PathCard),
});

const Slug = z.object({ slug: z.string().regex(/^[\w-]{1,64}$/) });
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
const TimeZone = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Unknown IANA time zone" },
  );

// XP for a first (observed) correct answer, plus a bonus when no hints were used.
const XP = sql`CASE WHEN correct THEN 10 + CASE WHEN hints_used = 0 THEN 5 ELSE 0 END ELSE 0 END`;

type LessonRow = {
  path_slug: string;
  path_title: string;
  tagline: string;
  origin: z.infer<typeof Origin>;
  enrolled_at: Date;
  course_slug: string;
  course_title: string;
  lesson_slug: string | null;
  lesson_title: string | null;
  level: number | null;
  total: number;
  done: number;
  last_active: Date | null;
};

// Per-lesson progress over the lesson's current version; used by /me/home and the course and path reads.
// Predict lessons count steps; learn/watch/practice/game-practice lessons are one part, done via part_completions.
const lessonTotal = sql`(CASE WHEN l.kind = 'predict'
  THEN (SELECT count(*) FROM steps s WHERE s.lesson_version_id = l.current_version_id)::int ELSE 1 END)`;
const lessonDone = (me: string) => sql`(CASE WHEN l.kind = 'predict'
  THEN (SELECT count(*) FROM steps s JOIN step_progress sp ON sp.step_id = s.id
    WHERE s.lesson_version_id = l.current_version_id AND sp.learner_id = ${me}
      AND sp.state IN ('revealed', 'skipped'))::int
  ELSE (SELECT count(*) FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me})::int END)`;
const lastActive = (me: string) => sql`GREATEST(
  (SELECT max(sp.updated_at) FROM steps s JOIN step_progress sp ON sp.step_id = s.id
    WHERE s.lesson_version_id = l.current_version_id AND sp.learner_id = ${me}),
  (SELECT pc.completed_at FROM part_completions pc WHERE pc.lesson_id = l.id AND pc.learner_id = ${me}))`;
const complete = (l: { done: number; total: number }) => l.total > 0 && l.done >= l.total;
// The learner's user id, to compare with owner_id.
const myUser = (me: string) => sql`(SELECT user_id FROM learners WHERE id = ${me})`;
// A course (alias w) the learner may see: public or their own. Paths can list other people's private courses.
// Lessons shown in lists: published, or AI drafts that are written when first played.
const listed = sql`(l.status = 'published' OR (l.source_kind = 'ai' AND l.status = 'draft'))`;
const visibleCourse = (me: string) => sql`(w.visibility = 'public' OR w.owner_id = ${myUser(me)})`;

async function pathCards(learnerId: string, official: boolean) {
  const { rows } = await db.execute<z.infer<typeof PathCard>>(sql`
    SELECT p.slug, p.title, p.tagline, p.origin,
      (SELECT count(*) FROM path_courses pc JOIN worlds w ON w.id = pc.world_id
        WHERE pc.path_id = p.id AND ${visibleCourse(learnerId)})::int AS "courseCount",
      (SELECT count(*) FROM enrollments e WHERE e.path_id = p.id)::int AS learners
    FROM paths p
    WHERE p.visibility = 'public'
      AND (p.origin = 'official') = ${official}
      AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.path_id = p.id AND e.learner_id = ${learnerId})
    ORDER BY learners DESC, p.created_at DESC
    LIMIT 6`);
  return rows;
}

const homeQuery = protectedProcedure.output(Home).query(async ({ ctx }) => {
    const me = ctx.learnerId;

    // shortcut: assumes the DB session zone is UTC (true on Neon and local docker), so created_at is UTC.
    const { rows: days } = await db.execute<{ day: string; solved: number; xp: number }>(sql`
      SELECT day, sum(solved)::int AS solved, sum(xp)::int AS xp FROM (
        SELECT to_char((a.created_at AT TIME ZONE 'UTC') AT TIME ZONE l.timezone, 'YYYY-MM-DD') AS day,
          count(*) FILTER (WHERE a.correct)::int AS solved, sum(${XP})::int AS xp
        FROM attempts a JOIN learners l ON l.id = a.learner_id
        WHERE a.learner_id = ${me} AND a.observed GROUP BY 1
        UNION ALL
        SELECT to_char((gc.created_at AT TIME ZONE 'UTC') AT TIME ZONE l.timezone, 'YYYY-MM-DD') AS day,
          0::int AS solved, (count(*) * 10)::int AS xp
        FROM game_completions gc JOIN learners l ON l.id = gc.learner_id
        WHERE gc.learner_id = ${me} GROUP BY 1
      ) activity GROUP BY day`);
    const { rows: [clock] } = await db.execute<{ today: string; goal: number }>(sql`
      SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today, daily_goal_xp AS goal
      FROM learners WHERE id = ${me}`);
    const today = clock!.today;
    const solved = new Map(days.map((d) => [d.day, d.solved]));

    const { rows } = await db.execute<LessonRow>(sql`
      SELECT p.slug AS path_slug, p.title AS path_title, p.tagline, p.origin, e.created_at AS enrolled_at,
        w.slug AS course_slug, w.title AS course_title,
        l.slug AS lesson_slug, l.title AS lesson_title, l.level,
        ${lessonTotal} AS total,
        ${lessonDone(me)} AS done,
        ${lastActive(me)} AS last_active
      FROM enrollments e
      JOIN paths p ON p.id = e.path_id
      JOIN path_courses pc ON pc.path_id = p.id
      JOIN worlds w ON w.id = pc.world_id
      LEFT JOIN lessons l ON l.world_id = w.id AND ${listed}
      WHERE e.learner_id = ${me} AND ${visibleCourse(me)}
      ORDER BY e.created_at DESC, p.id, pc.position, l.level, l.position, l.id`);

    // Group rows into path -> course -> lessons, keeping query order.
    type Path = { slug: string; title: string; tagline: string; origin: LessonRow["origin"]; active: number; courses: Map<string, { slug: string; title: string; lessons: LessonRow[] }> };
    const byPath = new Map<string, Path>();
    for (const row of rows) {
      let p = byPath.get(row.path_slug);
      if (!p) {
        p = { slug: row.path_slug, title: row.path_title, tagline: row.tagline, origin: row.origin, active: new Date(row.enrolled_at).getTime(), courses: new Map() };
        byPath.set(row.path_slug, p);
      }
      if (row.last_active) p.active = Math.max(p.active, new Date(row.last_active).getTime());
      let c = p.courses.get(row.course_slug);
      if (!c) p.courses.set(row.course_slug, (c = { slug: row.course_slug, title: row.course_title, lessons: [] }));
      if (row.lesson_slug) c.lessons.push(row);
    }

    // Continue = first unfinished lesson in the most recently active path that has one.
    let next: z.infer<typeof Home>["continue"] = null;
    for (const p of [...byPath.values()].sort((a, b) => b.active - a.active)) {
      const courses = [...p.courses.values()];
      const index = courses.findIndex((c) => c.lessons.some((l) => !complete(l)));
      if (index < 0) continue;
      const c = courses[index]!;
      const l = c.lessons.find((l) => !complete(l))!;
      next = {
        path: { slug: p.slug, title: p.title },
        course: { slug: c.slug, title: c.title, index, count: courses.length },
        lesson: { slug: l.lesson_slug!, title: l.lesson_title!, level: l.level!, done: l.done, total: l.total },
      };
      break;
    }

    return {
      stats: {
        xp: days.reduce((n, d) => n + d.xp, 0),
        todayXp: days.find((d) => d.day === today)?.xp ?? 0,
        dailyGoalXp: clock!.goal,
        streak: streak(solved, today),
        week: week(solved, today),
      },
      continue: next,
      paths: [...byPath.values()].map((p) => ({
        slug: p.slug,
        title: p.title,
        tagline: p.tagline,
        origin: p.origin,
        courses: [...p.courses.values()].map((c) => ({
          slug: c.slug,
          title: c.title,
          lessonsDone: c.lessons.filter(complete).length,
          lessonsTotal: c.lessons.length,
        })),
      })),
      official: await pathCards(me, true),
      community: await pathCards(me, false),
    };
  });

const enroll = protectedProcedure.input(Slug).mutation(async ({ ctx, input }) => {
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
        WHERE w.slug = ${input.slug} AND (w.visibility = 'public' OR w.owner_id = ${myUser(me)})`);
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
const publish = protectedProcedure.input(Slug).mutation(async ({ ctx, input }) => {
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

  // Empty body is a no-op. COALESCE keeps any field that was not sent.
const meUpdate = protectedProcedure
  .input(
    z
      .object({
        timezone: TimeZone.optional(),
        dailyGoalXp: z.union([z.literal(30), z.literal(50), z.literal(100)]).optional(),
      })
      .nullish(),
  )
  .mutation(async ({ ctx, input }) => {
      const { timezone, dailyGoalXp } = input ?? {};
      await db.execute(sql`
        UPDATE learners
        SET timezone = COALESCE(${timezone ?? null}, timezone),
          daily_goal_xp = COALESCE(${dailyGoalXp ?? null}, daily_goal_xp)
        WHERE id = ${ctx.learnerId}`);
  });

export const homeRouter = router({ get: homeQuery });
const generate = protectedProcedure
  .input(z.object({ prompt: z.string().trim().min(3).max(300) }))
  .output(z.object({ slug: z.string(), firstCourseSlug: z.string() }))
  .mutation(({ ctx, input }) => generatePath(ctx.learnerId, input.prompt));

export const pathsRouter = router({ list: pathList, get: pathGet, enroll, publish, generate });
export const coursesRouter = router({ get: courseGet });
export const meRouter = router({ update: meUpdate });
// Awards only for a real game block of the lesson's current game-practice version; the single part is partIdx 0.
const gameComplete = protectedProcedure
  .input(z.object({ lessonId: z.string().regex(/^[\w-]{1,64}$/), partIdx: z.number().int().min(0).max(100), blockId: z.string().regex(/^[\w-]{1,64}$/) }))
  .output(z.object({ awarded: z.boolean() }))
  .mutation(async ({ ctx, input }) => {
    // A recorded win also completes the lesson's part, in the same statement.
    const { rows } = await db.execute(sql`
      WITH win AS (
      INSERT INTO game_completions (learner_id, lesson_id, part_idx, block_id)
      SELECT ${ctx.learnerId}, l.id, ${input.partIdx}, ${input.blockId}
      FROM lessons l
      JOIN worlds w ON w.id = l.world_id
      JOIN learners me ON me.id = ${ctx.learnerId}
      JOIN lesson_versions v ON v.id = l.current_version_id
      WHERE (l.id = ${input.lessonId} OR l.slug = ${input.lessonId})
        AND l.status = 'published'
        AND (w.visibility = 'public' OR w.owner_id = me.user_id)
        AND ${input.partIdx} = 0
        AND v.content->>'kind' = 'game-practice'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.content->'doc'->'blocks') b
          WHERE b->>'id' = ${input.blockId} AND b->>'type' = 'game')
      ON CONFLICT DO NOTHING
      RETURNING lesson_id),
      pc AS (INSERT INTO part_completions (learner_id, lesson_id) SELECT ${ctx.learnerId}, lesson_id FROM win ON CONFLICT DO NOTHING)
      SELECT 1 FROM win`);
    return { awarded: rows.length > 0 };
  });
export const gamesRouter = router({ complete: gameComplete });
