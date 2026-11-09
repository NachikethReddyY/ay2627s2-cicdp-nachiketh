import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { gameBlocksOf, gameSchema, type GameProps } from "@learnquest/ui-catalog";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { lessonRef, meUser, visibleWorld } from "../access.ts";
import { BadSubmission, grade, submissionSchema } from "../games/grade.ts";

const lessonId = z.string().regex(/^[\w-]{1,64}$/);
const gameIndex = z.number().int().min(0).max(100);
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

// The stored (full) game, with the answers and hints the client never receives. Same visibility rule as lessons.get:
// a published lesson in a public course or one the caller owns; anything else is indistinguishable from missing.
async function loadGame(learnerId: string, ref: string, index: number): Promise<{ lessonDbId: string; blockId: string; game: GameProps }> {
  const { rows } = await db.execute(sql`
    SELECT l.id AS lesson_id, v.content->'doc' AS doc
    FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(ref)}
      AND l.status = 'published'
      AND ${visibleWorld(meUser)}
      AND v.content->>'kind' = 'game-practice'`);
  const row = rows[0] as { lesson_id: string; doc: unknown } | undefined;
  const block = row && gameBlocksOf(row.doc)[index];
  const parsed = block && gameSchema.safeParse(block.props);
  if (!row || !block || !parsed?.success) throw notFound();
  return { lessonDbId: row.lesson_id, blockId: block.id, game: parsed.data };
}

const hint = protectedProcedure
  .input(z.object({ lessonId, gameIndex, hintIndex: z.number().int().min(0).max(100) }))
  .output(z.object({ text: z.string() }))
  .query(async ({ ctx, input }) => {
    const { game } = await loadGame(ctx.learnerId, input.lessonId, input.gameIndex);
    const text = game.hints[input.hintIndex];
    if (text === undefined) throw notFound();
    return { text };
  });

// The server decides a win: only a `complete` verdict records progress (10 XP per block, once, via ON CONFLICT).
// A recorded win also completes the lesson's part, in the same statement. The single part is partIdx 0.
const check = protectedProcedure
  .input(z.object({ lessonId, gameIndex, submission: submissionSchema }))
  .output(z.object({ correct: z.boolean(), complete: z.boolean(), questionResults: z.array(z.boolean()).optional() }))
  .mutation(async ({ ctx, input }) => {
    const { lessonDbId, blockId, game } = await loadGame(ctx.learnerId, input.lessonId, input.gameIndex);
    let verdict;
    try {
      verdict = grade(game, input.submission);
    } catch (e) {
      if (e instanceof BadSubmission) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      throw e;
    }
    if (verdict.complete) {
      await db.execute(sql`
        WITH win AS (
          INSERT INTO game_completions (learner_id, lesson_id, part_idx, block_id)
          VALUES (${ctx.learnerId}, ${lessonDbId}, 0, ${blockId})
          ON CONFLICT DO NOTHING
          RETURNING lesson_id)
        INSERT INTO part_completions (learner_id, lesson_id) VALUES (${ctx.learnerId}, ${lessonDbId}) ON CONFLICT DO NOTHING`);
    }
    return verdict;
  });

export const gamesRouter = router({ hint, check });
