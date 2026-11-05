import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { streak, week } from "./streak.ts";
import { complete, lastActive, lessonDone, lessonTotal, listed, Origin, PathCard, visibleCourse } from "./shared.ts";

const Course = z.object({ slug: z.string(), title: z.string(), lessonsDone: z.number(), lessonsTotal: z.number() });
const Home = z.object({
  stats: z.object({
    xp: z.number(),
    todayXp: z.number(),
    dailyGoalXp: z.number(),
    streak: z.number(),
    // The zone the stats above are counted in, so the client can tell when its own zone differs.
    timezone: z.string(),
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
    const { rows: [clock] } = await db.execute<{ today: string; goal: number; timezone: string }>(sql`
      SELECT to_char(now() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today, daily_goal_xp AS goal, timezone
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
        timezone: clock!.timezone,
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

export const homeRouter = router({ get: homeQuery });
