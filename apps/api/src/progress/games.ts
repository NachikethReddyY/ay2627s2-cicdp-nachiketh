import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { gameBlocksOf, gameSchema, type GameProps } from "@learnquest/ui-catalog";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import type { Db } from "../db/client.ts";
import { withTx } from "../db/tx.ts";
import { lessonRef, meUser, playableLesson, visibleWorld } from "../access.ts";
import { BadSubmission, grade, submissionSchema } from "../games/grade.ts";
import { currentGameBlockWon, everyGameWon } from "./shared.ts";

const gameInput = z.object({
  lessonId: z.string().regex(/^[\w-]{1,64}$/),
  versionId: z.string().uuid().optional(),
  gameIndex: z.number().int().min(0).max(100),
});
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
const lessonChanged = () => new TRPCError({ code: "CONFLICT", message: "This lesson has changed. Reload it to continue." });

async function loadGame(database: Db, learnerId: string, input: z.infer<typeof gameInput>, lock: "check" | "hint"): Promise<{
  lessonDbId: string; versionId: string; partIndex: number; blockId: string; game: GameProps;
}> {
  const { rows: [lesson] } = await database.execute<{ id: string; current_version_id: string | null }>(sql`
    SELECT l.id, l.current_version_id FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    WHERE ${lessonRef(input.lessonId)} AND ${playableLesson()} AND ${visibleWorld(meUser)} AND l.kind = 'game-practice'
    ${lock === "check" ? sql`FOR NO KEY UPDATE OF l` : sql`FOR SHARE OF l`}`);
  if (!lesson?.current_version_id) throw notFound();
  if (input.versionId !== undefined && input.versionId !== lesson.current_version_id) throw lessonChanged();
  const { rows: [version] } = await database.execute<{ id: string; version: number; doc: unknown; has_other_versions: boolean }>(sql`
    SELECT v.id, v.version, v.content->'doc' AS doc,
      EXISTS (SELECT 1 FROM lesson_versions other WHERE other.lesson_id = v.lesson_id AND other.id <> v.id) AS has_other_versions
    FROM lesson_versions v
    WHERE v.id = ${lesson.current_version_id} AND v.content->>'kind' = 'game-practice'`);
  if (!version) throw notFound();
  if (input.versionId === undefined && (version.version !== 1 || version.has_other_versions)) throw lessonChanged();
  const block = gameBlocksOf(version.doc)[input.gameIndex];
  const parsed = block && gameSchema.safeParse(block.props);
  if (!block || !parsed?.success) throw notFound();
  return { lessonDbId: lesson.id, versionId: version.id, partIndex: version.version - 1, blockId: block.id, game: parsed.data };
}

const hint = protectedProcedure
  .input(gameInput.extend({ hintIndex: z.number().int().min(0).max(100) }))
  .output(z.object({ text: z.string() }))
  .query(({ ctx, input }) => withTx(async (tx) => {
    const { game } = await loadGame(tx, ctx.learnerId, input, "hint");
    const text = game.hints[input.hintIndex];
    if (text === undefined) throw notFound();
    return { text };
  }));

const check = protectedProcedure
  .input(gameInput.extend({ submission: submissionSchema }))
  .output(z.object({ correct: z.boolean(), complete: z.boolean(), questionResults: z.array(z.boolean()).optional() }))
  .mutation(({ ctx, input }) => withTx(async (tx) => {
    const learnerId = ctx.learnerId;
    const { lessonDbId, versionId, partIndex, blockId, game } = await loadGame(tx, learnerId, input, "check");
    let verdict;
    try {
      verdict = grade(game, input.submission);
    } catch (e) {
      if (e instanceof BadSubmission) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      throw e;
    }
    if (verdict.complete) {
      await tx.execute(sql`
        INSERT INTO game_completions (learner_id, lesson_id, part_idx, block_id)
        SELECT ${learnerId}, ${lessonDbId}, ${partIndex}, ${blockId}
        WHERE NOT ${currentGameBlockWon(learnerId, lessonDbId, versionId, blockId)}
        ON CONFLICT DO NOTHING`);
      await tx.execute(sql`
        INSERT INTO part_completions (learner_id, lesson_id)
        SELECT ${learnerId}, l.id FROM lessons l WHERE l.id = ${lessonDbId} AND ${everyGameWon(learnerId)}
        ON CONFLICT DO NOTHING`);
    }
    return verdict;
  }));

export const gamesRouter = router({ hint, check });
