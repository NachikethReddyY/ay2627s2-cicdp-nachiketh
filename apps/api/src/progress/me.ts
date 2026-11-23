import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { userOfLearner, visibleWorld } from "../access.ts";
import { catchUpMastery, MASTERED_AT } from "./mastery.ts";
import { Slug, listed } from "./shared.ts";
import { handleRouter } from "./handle.ts";

const TimeZone = z.string().max(64);

const meUpdate = protectedProcedure
  .input(
    z
      .object({
        timezone: TimeZone.optional(),
        dailyGoalXp: z.union([z.literal(30), z.literal(50), z.literal(100)]).optional(),
      })
      .nullish(),
  )
  .output(z.void())
  .mutation(async ({ ctx, input }) => {
    const { timezone, dailyGoalXp } = input ?? {};
    if (timezone !== undefined) {
      const { rows } = await db.execute(sql`SELECT 1 FROM pg_timezone_names WHERE name = ${timezone}`);
      if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown IANA time zone" });
    }
    await db.execute(sql`
      UPDATE learners
      SET timezone = COALESCE(${timezone ?? null}, timezone),
        daily_goal_xp = COALESCE(${dailyGoalXp ?? null}, daily_goal_xp)
      WHERE id = ${ctx.learnerId}`);
  });

async function mustWorld(learnerId: string, slug: string) {
  const { rows } = await db.execute<{ id: string }>(
    sql`SELECT w.id FROM worlds w WHERE w.slug = ${slug} AND ${visibleWorld(userOfLearner(learnerId))}`,
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
  return rows[0].id;
}

const meMastery = protectedProcedure
  .input(z.object({ world: Slug.shape.slug }))
  .output(
    z.array(z.object({ conceptSlug: z.string(), name: z.string(), pKnown: z.number(), nObs: z.number(), mastered: z.boolean() })),
  )
  .query(async ({ ctx, input }) => {
    const worldId = await mustWorld(ctx.learnerId, input.world);
    await catchUpMastery(ctx.learnerId, worldId);
    const { rows } = await db.execute<{ slug: string; name: string; p_known: number; n_obs: number }>(sql`
      SELECT c.slug, c.name, m.p_known, m.n_obs FROM mastery m JOIN concepts c ON c.id = m.concept_id
      WHERE m.learner_id = ${ctx.learnerId} AND c.world_id = ${worldId}
      ORDER BY c.name, c.slug`);
    return rows.map((r) => ({
      conceptSlug: r.slug,
      name: r.name,
      pKnown: r.p_known,
      nObs: r.n_obs,
      mastered: r.p_known >= MASTERED_AT,
    }));
  });

const meNext = protectedProcedure
  .input(z.object({ world: Slug.shape.slug }))
  .output(
    z
      .object({
        action: z.enum(["start", "learn", "practice", "advance", "done"]),
        lessonSlug: z.string().nullable(),
        lessonTitle: z.string().nullable(),
        conceptSlug: z.string().nullable(),
        reason: z.string(),
        reasonCode: z.string(),
      })
      .nullable(),
  )
  .query(async ({ ctx, input }) => {
    const worldId = await mustWorld(ctx.learnerId, input.world);
    await catchUpMastery(ctx.learnerId, worldId);
    const { rows } = await db.execute<{
      action: "start" | "learn" | "practice" | "advance" | "done";
      lesson_slug: string | null;
      lesson_title: string | null;
      concept_slug: string | null;
      reason: string;
      reason_code: string;
    }>(sql`
      SELECT r.action, l.slug AS lesson_slug, l.title AS lesson_title, c.slug AS concept_slug, r.reason, r.reason_code
      FROM recommendations r
      LEFT JOIN lessons l ON l.id = r.lesson_id
      LEFT JOIN concepts c ON c.id = r.concept_id
      WHERE r.learner_id = ${ctx.learnerId} AND r.world_id = ${worldId}
        AND (r.lesson_id IS NULL OR EXISTS (SELECT 1 FROM lessons l WHERE l.id = r.lesson_id AND ${listed}))
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1`);
    const r = rows[0];
    if (!r) return null;
    return { action: r.action, lessonSlug: r.lesson_slug, lessonTitle: r.lesson_title, conceptSlug: r.concept_slug, reason: r.reason, reasonCode: r.reason_code };
  });

export const meRouter = router({ update: meUpdate, mastery: meMastery, next: meNext, handle: handleRouter });
