import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { gameBlocksOf, gameSchema, type GameProps } from "@learnquest/ui-catalog";
import { protectedProcedure, router } from "../trpc/trpc.ts";
import type { Db } from "../db/client.ts";
import { gameAttempts } from "../db/schema.ts";
import { withTx } from "../db/tx.ts";
import { lessonRef, meUser, playableLesson, visibleWorld } from "../access.ts";
import { BadSubmission, grade, submissionSchema } from "../games/grade.ts";
import { catchUpMastery } from "./mastery.ts";
import { recordLessonObservation } from "./observation.ts";
import { currentGameBlockWon, everyGameWon } from "./shared.ts";

const gameInput = z.object({
  lessonId: z.string().regex(/^[\w-]{1,64}$/),
  versionId: z.string().uuid().optional(),
  gameIndex: z.number().int().min(0).max(100),
});
const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
const lessonChanged = () => new TRPCError({ code: "CONFLICT", message: "This lesson has changed. Reload it to continue." });

async function loadGame(database: Db, learnerId: string, input: z.infer<typeof gameInput>, write: boolean): Promise<{
  lessonDbId: string; versionId: string; partIndex: number; blockId: string; game: GameProps;
}> {
  const { rows: [lesson] } = await database.execute<{ id: string; current_version_id: string | null }>(sql`
    SELECT l.id, l.current_version_id FROM lessons l
    JOIN worlds w ON w.id = l.world_id
    JOIN learners me ON me.id = ${learnerId}
    WHERE ${lessonRef(input.lessonId)} AND ${playableLesson()} AND ${visibleWorld(meUser)} AND l.kind = 'game-practice'
    ${write ? sql`FOR NO KEY UPDATE OF l` : sql`FOR SHARE OF l`}`);
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

type LoadedGame = Awaited<ReturnType<typeof loadGame>>;
const ATTEMPTS = 3;
const attemptLimit = (game: GameProps) => game.shell.lives ?? ATTEMPTS;
const attemptDay = () => new Date().toISOString().slice(0, 10);
const attemptKey = (learnerId: string, { versionId, blockId }: LoadedGame) =>
  ({ learnerId, lessonVersionId: versionId, blockId });

async function loadAttempts(tx: Db, key: ReturnType<typeof attemptKey>, day: string) {
  const [row] = await tx.select().from(gameAttempts).where(and(
    eq(gameAttempts.learnerId, key.learnerId),
    eq(gameAttempts.lessonVersionId, key.lessonVersionId),
    eq(gameAttempts.blockId, key.blockId),
  ));
  return {
    misses: row?.attemptDay === day ? row.misses : 0,
    hintsRevealed: row?.hintsRevealed ?? 0,
  };
}

async function saveAttempts(tx: Db, key: ReturnType<typeof attemptKey>, day: string, state: Awaited<ReturnType<typeof loadAttempts>>) {
  const change = { attemptDay: day, ...state };
  await tx.insert(gameAttempts).values({ ...key, ...change }).onConflictDoUpdate({
    target: [gameAttempts.learnerId, gameAttempts.lessonVersionId, gameAttempts.blockId],
    set: change,
  });
}

const status = protectedProcedure.input(gameInput).query(({ ctx, input }) => withTx(async (tx) => {
  const loaded = await loadGame(tx, ctx.learnerId, input, false);
  const { misses } = await loadAttempts(tx, attemptKey(ctx.learnerId, loaded), attemptDay());
  const maxAttempts = attemptLimit(loaded.game);
  return { remainingAttempts: Math.max(0, maxAttempts - misses), maxAttempts };
}));

const hint = protectedProcedure
  .input(gameInput.extend({ hintIndex: z.number().int().min(0).max(100) }))
  .output(z.object({ text: z.string() }))
  .mutation(({ ctx, input }) => withTx(async (tx) => {
    const loaded = await loadGame(tx, ctx.learnerId, input, true);
    const text = loaded.game.hints[input.hintIndex];
    if (text === undefined) throw notFound();
    const key = attemptKey(ctx.learnerId, loaded);
    const day = attemptDay();
    const state = await loadAttempts(tx, key, day);
    if (input.hintIndex > state.hintsRevealed) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Read the previous hint first" });
    }
    if (input.hintIndex === state.hintsRevealed) {
      await saveAttempts(tx, key, day, { ...state, hintsRevealed: state.hintsRevealed + 1 });
    }
    return { text };
  }));

async function recordWin(tx: Db, learnerId: string, { lessonDbId, versionId, partIndex, blockId }: LoadedGame) {
  const { rows: wins } = await tx.execute(sql`
    INSERT INTO game_completions (learner_id, lesson_id, part_idx, block_id)
    SELECT ${learnerId}, ${lessonDbId}, ${partIndex}, ${blockId}
    WHERE NOT ${currentGameBlockWon(learnerId, lessonDbId, versionId, blockId)}
    ON CONFLICT DO NOTHING RETURNING block_id`);
  const { rows: completed } = await tx.execute(sql`
    WITH completed AS (
      SELECT l.id FROM lessons l WHERE l.id = ${lessonDbId} AND ${everyGameWon(learnerId)}
    ), recorded AS (
      INSERT INTO part_completions (learner_id, lesson_id)
      SELECT ${learnerId}, id FROM completed
      ON CONFLICT DO NOTHING
    )
    SELECT id FROM completed`);
  return wins.length > 0 && completed.length > 0;
}

const isWatchGrid = (game: GameProps) => game.kind.kind === "grid" && game.kind.mode === "watch";

const check = protectedProcedure
  .input(gameInput.extend({ submission: submissionSchema }))
  .output(z.object({ correct: z.boolean(), complete: z.boolean(), questionCorrect: z.boolean().optional(), remainingAttempts: z.number().int().nonnegative(), lessonJustCompleted: z.boolean() }))
  .mutation(async ({ ctx, input }) => {
    const committed = await withTx(async (tx) => {
      const learnerId = ctx.learnerId;
      const loaded = await loadGame(tx, learnerId, input, true);
      const { game } = loaded;
      if (isWatchGrid(game)) throw new TRPCError({ code: "BAD_REQUEST", message: "Watch games complete with games.completeWatch" });
      const key = attemptKey(learnerId, loaded);
      const day = attemptDay();
      const state = await loadAttempts(tx, key, day);
      const limit = attemptLimit(game);
      const remaining = Math.max(0, limit - state.misses);
      if (remaining === 0) return { observed: false, result: { correct: false, complete: false, remainingAttempts: 0, lessonJustCompleted: false } };
      let verdict;
      try {
        verdict = grade(game, input.submission);
      } catch (e) {
        if (e instanceof BadSubmission) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }
      const firstQuestion = game.kind.kind === "quiz" ? game.kind.questions[0] : undefined;
      const correct = firstQuestion && input.submission.kind === "quiz"
        ? input.submission.answers[0] === firstQuestion.answer
        : verdict.correct;
      const observed = await recordLessonObservation(tx, {
        learnerId,
        lessonVersionId: loaded.versionId,
        activityKey: `game:${loaded.blockId}`,
        kind: firstQuestion ? "mcq" : "practice",
        optionCount: firstQuestion?.options.length,
        correct,
        hintsUsed: state.hintsRevealed,
      });
      const lessonJustCompleted = verdict.complete && await recordWin(tx, learnerId, loaded);
      const miss = !verdict.correct && !verdict.questionCorrect;
      if (miss) await saveAttempts(tx, key, day, { ...state, misses: state.misses + 1 });
      return { observed, result: { ...verdict, remainingAttempts: remaining - Number(miss), lessonJustCompleted } };
    });
    if (committed.observed) await catchUpMastery(ctx.learnerId);
    return committed.result;
  });

const completeWatch = protectedProcedure
  .input(gameInput)
  .output(z.object({ correct: z.literal(true), complete: z.literal(true), remainingAttempts: z.number().int().nonnegative(), lessonJustCompleted: z.boolean() }))
  .mutation(({ ctx, input }) => withTx(async (tx) => {
    const learnerId = ctx.learnerId;
    const loaded = await loadGame(tx, learnerId, input, true);
    const { game } = loaded;
    const kind = game.kind;
    if (kind.kind !== "grid" || kind.mode !== "watch" || !kind.solution) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Only a watch game completes this way" });
    }
    if (!grade(game, { kind: "grid", program: kind.solution }).complete) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The authored solution does not solve this game" });
    }
    const lessonJustCompleted = await recordWin(tx, learnerId, loaded);
    const { misses } = await loadAttempts(tx, attemptKey(learnerId, loaded), attemptDay());
    return { correct: true as const, complete: true as const, remainingAttempts: Math.max(0, attemptLimit(game) - misses), lessonJustCompleted };
  }));

export const gamesRouter = router({ status, hint, check, completeWatch });
