import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { lessonRef, meUser, playableLesson, visibleWorld } from "../access.ts";

const complete = protectedProcedure
  .input(z.object({ lessonId: z.string().regex(/^[\w-]{1,64}$/) }))
  .output(z.object({ ok: z.literal(true) }))
  .mutation(async ({ ctx, input }) => {
    const {
      rows: [lesson],
    } = await db.execute<{ id: string; kind: string }>(sql`
      SELECT l.id, l.kind
      FROM lessons l
      JOIN worlds w ON w.id = l.world_id
      JOIN learners me ON me.id = ${ctx.learnerId}
      WHERE ${lessonRef(input.lessonId)}
        AND l.current_version_id IS NOT NULL
        AND ${playableLesson()}
        AND ${visibleWorld(meUser)}`);
    if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
    if (lesson.kind === "practice" || lesson.kind === "scrim" || lesson.kind === "game-practice")
      throw new TRPCError({ code: "FORBIDDEN", message: "This lesson is completed by playing it" });
    if (lesson.kind === "learn" || lesson.kind === "watch")
      throw new TRPCError({ code: "FORBIDDEN", message: "This lesson is completed by its closing check" });
    if (lesson.kind !== "predict") {
      await db.execute(sql`
        INSERT INTO part_completions (learner_id, lesson_id) VALUES (${ctx.learnerId}, ${lesson.id})
        ON CONFLICT DO NOTHING`);
    }
    return { ok: true as const };
  });

export const partsRouter = router({ complete });
