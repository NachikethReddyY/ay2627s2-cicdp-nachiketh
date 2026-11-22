import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { gameBlocksOf, gameSchema, type GameProps } from "@learnquest/ui-catalog";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { lessonRef, meUser, playableLesson, visibleWorld } from "../access.ts";
import { BadSubmission, grade, submissionSchema } from "../games/grade.ts";
import { everyGameWon } from "./shared.ts";

const lessonId = z.string().regex(/^[\w-]{1,64}$/);
const gameIndex = z.number().int().min(0).max(100);
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

async function loadGame(learnerId: string, ref: string, index: number): Promise<{ lessonDbId: string; blockId: string; winIdx: number; game: GameProps }> {
  const { rows } = await db.execute(sql`
    SELECT l.id AS lesson_id, v.version - 1 AS win_idx, v.content->'doc' AS doc
    FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(ref)}
      AND ${playableLesson()}
      AND ${visibleWorld(meUser)}
      AND v.content->>'kind' = 'game-practice'`);
  const row = rows[0] as { lesson_id: string; win_idx: number; doc: unknown } | undefined;
  const block = row && gameBlocksOf(row.doc)[index];
  const parsed = block && gameSchema.safeParse(block.props);
  if (!row || !block || !parsed?.success) throw notFound();
  return { lessonDbId: row.lesson_id, blockId: block.id, winIdx: row.win_idx, game: parsed.data };
}

async function everyBlockWon(learnerId: string, lessonDbId: string): Promise<boolean> {
  const {
    rows: [row],
  } = await db.execute<{ won: boolean }>(sql`
    SELECT ${everyGameWon(learnerId)} AS won FROM lessons l WHERE l.id = ${lessonDbId}`);
  return row.won;
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

const check = protectedProcedure
  .input(z.object({ lessonId, gameIndex, submission: submissionSchema }))
  .output(z.object({ correct: z.boolean(), complete: z.boolean(), questionResults: z.array(z.boolean()).optional() }))
  .mutation(async ({ ctx, input }) => {
    const { lessonDbId, blockId, winIdx, game } = await loadGame(ctx.learnerId, input.lessonId, input.gameIndex);
    let verdict;
    try {
      verdict = grade(game, input.submission);
    } catch (e) {
      if (e instanceof BadSubmission) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      throw e;
    }
    if (verdict.complete) {
      await db.execute(sql`
        INSERT INTO game_completions (learner_id, lesson_id, part_idx, block_id)
        VALUES (${ctx.learnerId}, ${lessonDbId}, ${winIdx}, ${blockId})
        ON CONFLICT DO NOTHING`);
      if (await everyBlockWon(ctx.learnerId, lessonDbId)) {
        await db.execute(sql`
          INSERT INTO part_completions (learner_id, lesson_id) VALUES (${ctx.learnerId}, ${lessonDbId})
          ON CONFLICT DO NOTHING`);
      }
    }
    return verdict;
  });

export const gamesRouter = router({ hint, check });
