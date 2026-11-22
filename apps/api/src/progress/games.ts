import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { gameBlocksOf, gameSchema, type GameProps } from "@learnquest/ui-catalog";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import { db } from "../db/client.ts";
import { lessonRef, meUser, playableLesson, visibleWorld } from "../access.ts";
import { BadSubmission, grade, submissionSchema } from "../games/grade.ts";
import { everyGameWon, gameBlockKeys, gameWinKey } from "./shared.ts";

const lessonId = z.string().regex(/^[\w-]{1,64}$/);
const gameIndex = z.number().int().min(0).max(100);
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

async function loadGame(learnerId: string, ref: string, versionId: string, index: number): Promise<{ lessonDbId: string; blockHash: string; game: GameProps }> {
  const { rows } = await db.execute(sql`
    SELECT l.id AS lesson_id, v.id AS version_id, v.content->'doc' AS doc,
      ARRAY(SELECT k.hash FROM ${gameBlockKeys(sql`v.content`)} k ORDER BY k.ord) AS hashes
    FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    JOIN lesson_versions v ON v.id = l.current_version_id
    WHERE ${lessonRef(ref)}
      AND ${playableLesson()}
      AND ${visibleWorld(meUser)}
      AND v.content->>'kind' = 'game-practice'`);
  const row = rows[0] as { lesson_id: string; version_id: string; doc: unknown; hashes: string[] } | undefined;
  if (row && row.version_id !== versionId) throw new TRPCError({ code: "CONFLICT", message: "This lesson has changed. Reload it to continue." });
  const block = row && gameBlocksOf(row.doc)[index];
  const parsed = block && gameSchema.safeParse(block.props);
  const blockHash = row?.hashes[index];
  if (!row || !block || !blockHash || !parsed?.success) throw notFound();
  return { lessonDbId: row.lesson_id, blockHash, game: parsed.data };
}

async function everyBlockWon(learnerId: string, lessonDbId: string): Promise<boolean> {
  const {
    rows: [row],
  } = await db.execute<{ won: boolean }>(sql`
    SELECT ${everyGameWon(learnerId)} AS won FROM lessons l WHERE l.id = ${lessonDbId}`);
  return row.won;
}

const hint = protectedProcedure
  .input(z.object({ lessonId, versionId: z.string().uuid(), gameIndex, hintIndex: z.number().int().min(0).max(100) }))
  .output(z.object({ text: z.string() }))
  .query(async ({ ctx, input }) => {
    const { game } = await loadGame(ctx.learnerId, input.lessonId, input.versionId, input.gameIndex);
    const text = game.hints[input.hintIndex];
    if (text === undefined) throw notFound();
    return { text };
  });

const check = protectedProcedure
  .input(z.object({ lessonId, versionId: z.string().uuid(), gameIndex, submission: submissionSchema }))
  .output(z.object({ correct: z.boolean(), complete: z.boolean(), questionResults: z.array(z.boolean()).optional() }))
  .mutation(async ({ ctx, input }) => {
    const { lessonDbId, blockHash, game } = await loadGame(ctx.learnerId, input.lessonId, input.versionId, input.gameIndex);
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
        VALUES (${ctx.learnerId}, ${lessonDbId}, 0, ${gameWinKey(blockHash)})
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
