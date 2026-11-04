import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";

// Marks a learn/watch lesson complete. Predict lessons count steps, so they are a no-op here.
// Practice and game-practice need server evidence (no verified practice result exists yet; games.complete records game wins).
const complete = protectedProcedure
  .input(z.object({ lessonId: z.string().regex(/^[\w-]{1,64}$/) }))
  .output(z.object({ ok: z.literal(true) }))
  .mutation(async ({ ctx, input }) => {
    const {
      rows: [lesson],
    } = await db.execute<{ id: string; kind: string }>(sql`
      SELECT l.id, l.kind FROM lessons l
      JOIN worlds w ON w.id = l.world_id
      JOIN learners me ON me.id = ${ctx.learnerId}
      WHERE (l.id = ${input.lessonId} OR l.slug = ${input.lessonId})
        AND l.status = 'published'
        AND (w.visibility = 'public' OR w.owner_id = me.user_id)`);
    if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
    if (lesson.kind === "practice" || lesson.kind === "game-practice")
      throw new TRPCError({ code: "FORBIDDEN", message: "This lesson is completed by playing it" });
    if (lesson.kind !== "predict") {
      await db.execute(sql`
        INSERT INTO part_completions (learner_id, lesson_id) VALUES (${ctx.learnerId}, ${lesson.id})
        ON CONFLICT DO NOTHING`);
    }
    return { ok: true as const };
  });

export const partsRouter = router({ complete });
