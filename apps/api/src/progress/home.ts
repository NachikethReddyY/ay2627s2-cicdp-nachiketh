import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { steps } from "../db/schema.ts";
import { publicScrimSegments, servedGateIds } from "../lessons/scrim.ts";
import { loadScrimGates } from "../lessons/scrim-gates.ts";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { activityEvents } from "./activity.ts";
import { learning } from "./assessment.ts";
import { NextStep, nextForWorld } from "./me.ts";
import { streak, week } from "./streak.ts";
import { complete, lastActive, lessonDone, lessonTotal, listed, Origin, PathCard, unshadowedMastery, visibleCourse } from "./shared.ts";

const Course = z.object({ slug: z.string(), title: z.string(), lessonsDone: z.number(), lessonsTotal: z.number() });

export function firstCodeBlock(prompt: string): string[] | null {
  const start = prompt.indexOf("```");
  if (start < 0) return null;
  const bodyStart = prompt.indexOf("\n", start + 3);
  if (bodyStart < 0) return null;
  const end = prompt.indexOf("```", bodyStart + 1);
  if (end < 0) return null;
  let bodyEnd = end;
  while (bodyEnd > bodyStart + 1 && prompt[bodyEnd - 1] === "\n") bodyEnd--;
  const lines = prompt.slice(bodyStart + 1, bodyEnd).split("\n").slice(0, 6);
  return lines.length > 0 ? lines : null;
}
const Resume = z.object({ lessonSlug: z.string(), title: z.string(), courseSlug: z.string() });

const Home = z.object({
  stats: z.object({
    xp: z.number(),
    todayXp: z.number(),
    dailyGoalXp: z.number(),
    streak: z.number(),
    timezone: z.string(),
    week: z.array(z.object({ day: z.string(), solved: z.number(), state: z.enum(["past", "today", "future"]) })),
  }),
  continue: z
    .object({
      path: z.object({ slug: z.string(), title: z.string() }),
      course: z.object({ slug: z.string(), title: z.string(), index: z.number(), count: z.number() }),
      lesson: z.object({ slug: z.string(), title: z.string(), level: z.number(), done: z.number(), total: z.number() }),
      snippet: z.array(z.string()).nullable(),
      recommendation: NextStep.nullable(),
    })
    .nullable(),
  resume: Resume.nullable(),
  learning: z.array(z.object({ slug: z.string(), pre: z.boolean().nullable(), post: z.boolean().nullable() })),
  mastery: z.array(z.object({ name: z.string(), pKnown: z.number() })),
  leaderboard: z.object({
    xp: z.number(),
    rank: z.number().nullable(),
    rows: z.array(z.object({ handle: z.string(), xp: z.number() })),
  }),
  paths: z.array(
    z.object({ slug: z.string(), title: z.string(), tagline: z.string(), origin: Origin, courses: z.array(Course) }),
  ),
  official: z.array(PathCard),
  community: z.array(PathCard),
});

type LessonRow = {
  path_slug: string;
  path_title: string;
  tagline: string;
  origin: z.infer<typeof Origin>;
  enrolled_at: Date;
  course_id: string;
  course_slug: string;
  course_title: string;
  lesson_slug: string | null;
  lesson_title: string | null;
  level: number | null;
  total: number;
  done: number;
  last_active: Date | null;
};

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

async function continueSnippet(lessonSlug: string, learnerId: string) {
  const { rows: [lesson] } = await db.execute<{ kind: string; versionId: string | null }>(sql`
    SELECT kind, current_version_id AS "versionId" FROM lessons WHERE slug = ${lessonSlug}`);
  if (!lesson?.versionId) return null;
  if (lesson.kind !== "scrim") {
    const { rows: [first] } = await db.execute<{ prompt: string | null }>(sql`
      SELECT s.public->>'prompt' AS prompt FROM steps s WHERE s.lesson_version_id = ${lesson.versionId}
      ORDER BY s.idx LIMIT 1`);
    return first?.prompt ? firstCodeBlock(first.prompt) : null;
  }
  const loaded = await loadScrimGates(lesson.versionId, learnerId).catch((error: unknown) => {
    if (error instanceof TRPCError) return null;
    throw error;
  });
  if (!loaded) return null;
  const [firstServed] = servedGateIds(publicScrimSegments(loaded.scrim, loaded.gates).segments);
  if (!firstServed) return null;
  const [step] = await db.select({ prompt: sql<string | null>`${steps.public}->>'prompt'` }).from(steps).where(eq(steps.id, firstServed));
  return step?.prompt ? firstCodeBlock(step.prompt) : null;
}

const homeQuery = protectedProcedure.output(Home).query(async ({ ctx }) => {
    const me = ctx.learnerId;

    const { rows: days } = await db.execute<{ day: string; solved: number; xp: number }>(sql`
      SELECT to_char((a.created_at AT TIME ZONE current_setting('TimeZone')) AT TIME ZONE l.timezone, 'YYYY-MM-DD') AS day,
        sum(a.attempts)::int AS solved, sum(a.xp)::int AS xp
      FROM (${activityEvents(me)}) a JOIN learners l ON l.id = a.learner_id
      GROUP BY 1`);
    const { rows: [clock] } = await db.execute<{ today: string; goal: number; timezone: string }>(sql`
      SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today, daily_goal_xp AS goal, timezone
      FROM learners WHERE id = ${me}`);
    const today = clock.today;
    const solved = new Map(days.map((d) => [d.day, d.solved]));

    const { rows } = await db.execute<LessonRow>(sql`
      SELECT p.slug AS path_slug, p.title AS path_title, p.tagline, p.origin, e.created_at AS enrolled_at,
        w.id AS course_id, w.slug AS course_slug, w.title AS course_title,
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

    type Path = { slug: string; title: string; tagline: string; origin: LessonRow["origin"]; active: number; courses: Map<string, { id: string; slug: string; title: string; lessons: LessonRow[] }> };
    const byPath = new Map<string, Path>();
    let resume: z.infer<typeof Resume> | null = null;
    let resumeAt = -Infinity;
    for (const row of rows) {
      let p = byPath.get(row.path_slug);
      if (!p) {
        p = { slug: row.path_slug, title: row.path_title, tagline: row.tagline, origin: row.origin, active: new Date(row.enrolled_at).getTime(), courses: new Map() };
        byPath.set(row.path_slug, p);
      }
      if (row.last_active) {
        const activeAt = new Date(row.last_active).getTime();
        p.active = Math.max(p.active, activeAt);
        if (activeAt > resumeAt && row.lesson_slug && row.lesson_title && row.total > 0 && !complete(row)) {
          resumeAt = activeAt;
          resume = { lessonSlug: row.lesson_slug, title: row.lesson_title, courseSlug: row.course_slug };
        }
      }
      let c = p.courses.get(row.course_slug);
      if (!c) p.courses.set(row.course_slug, (c = { id: row.course_id, slug: row.course_slug, title: row.course_title, lessons: [] }));
      if (row.lesson_slug) c.lessons.push(row);
    }

    let next: Omit<NonNullable<z.infer<typeof Home>["continue"]>, "snippet"> | null = null;
    const activePaths = [...byPath.values()].sort((a, b) => b.active - a.active);
    let activeCourseId: string | undefined;
    findNext: for (const p of activePaths) {
      const courses = [...p.courses.values()];
      for (const [index, c] of courses.entries()) {
        if (c.lessons.length === 0) continue;
        activeCourseId ??= c.id;
        const recommendation = await nextForWorld(me, c.id);
        const l = c.lessons.find((l) => l.lesson_slug === recommendation?.lessonSlug) ??
          c.lessons.find((l) => !complete(l));
        if (!l && !recommendation?.lessonSlug) continue;
        const assessment = recommendation?.action === "assess" ? (await db.execute<{ slug: string; title: string; level: number; done: number; total: number }>(sql`
          SELECT l.slug, l.title, l.level, ${lessonDone(me)} AS done, ${lessonTotal} AS total
          FROM lessons l WHERE l.world_id = ${c.id} AND l.slug = ${recommendation.lessonSlug} AND l.assessment IS NOT NULL`)).rows[0] : undefined;
        if (!assessment && !l) continue;
        next = {
          path: { slug: p.slug, title: p.title },
          course: { slug: c.slug, title: c.title, index, count: courses.length },
          lesson: assessment ?? { slug: l!.lesson_slug!, title: l!.lesson_title!, level: l!.level!, done: l!.done, total: l!.total },
          recommendation,
        };
        activeCourseId = c.id;
        break findNext;
      }
    }

    const snippet = next && next.recommendation?.action !== "review" ? await continueSnippet(next.lesson.slug, me) : null;

    const { rows: ranked } = await db.execute<{ handle: string; xp: number; position: number; own: boolean }>(sql`
      WITH x AS (${activityEvents()}),
      totals AS (
        SELECT l.id, l.handle, coalesce(sum(x.xp), 0)::int AS xp
        FROM learners l
        LEFT JOIN x ON x.learner_id = l.id AND x.created_at >= now() - interval '7 days'
        GROUP BY l.id, l.handle
      ),
      ranked AS (
        SELECT id, handle, xp, (row_number() OVER (ORDER BY xp DESC, id))::int AS position
        FROM totals
      )
      SELECT handle, xp, position, id = ${me} AS own
      FROM ranked WHERE position <= 5 OR id = ${me}
      ORDER BY position`);
    const self = ranked.find((row) => row.own);
    const board = ranked.slice(0, 5).map(({ handle, xp }) => ({ handle, xp }));

    const { rows: mastery } = await db.execute<{ name: string; pKnown: number }>(sql`
      SELECT c.name, m.p_known::float8 AS "pKnown"
      FROM mastery m JOIN concepts c ON c.id = m.concept_id
      WHERE m.learner_id = ${me} AND m.n_obs > 0 AND ${unshadowedMastery}
      ORDER BY m.n_obs DESC, m.p_known DESC LIMIT 4`);

    return {
      stats: {
        xp: days.reduce((n, d) => n + d.xp, 0),
        todayXp: days.find((d) => d.day === today)?.xp ?? 0,
        dailyGoalXp: clock.goal,
        streak: streak(solved, today),
        timezone: clock.timezone,
        week: week(solved, today),
      },
      continue: next && { ...next, snippet },
      resume,
      mastery,
      learning: activeCourseId ? await learning(me, activeCourseId) : [],
      leaderboard: {
        xp: self?.xp ?? 0,
        rank: self && (self.xp > 0 || self.position <= board.length) ? self.position : null,
        rows: board,
      },
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

export const homeRouter = router({ get: homeQuery });
