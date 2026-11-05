import { sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { lessonRef, meUser, visibleWorld } from "../access.ts";

// Trust model: the win itself is claimed by the client and is not verified (the game runs in the browser and
// the server has no replay of it). The server only checks that the block is a real game block of the lesson's
// current game-practice version, so a client can claim wins that exist, nothing more. The reward is small
// (10 XP per block, once, via ON CONFLICT) and only affects the caller's own progress.
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
      WHERE ${lessonRef(input.lessonId)}
        AND l.status = 'published'
        AND ${visibleWorld(meUser)}
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
