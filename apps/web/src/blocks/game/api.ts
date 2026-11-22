import type { GridProgram } from "@learnquest/ui-catalog";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc.ts";
import type { GameCompletionContext } from "../registry.ts";

export type Submission =
  | { kind: "quiz"; answers: number[] }
  | { kind: "order"; order: string[] }
  | { kind: "match"; pairs: { left: string; right: string }[] }
  | { kind: "sort"; cards: { text: string; bucket: number }[] }
  | { kind: "grid"; program: GridProgram }
  | { kind: "physics"; angle: number; speed: number };

export type Verdict = { correct: boolean; complete: boolean; questionResults?: boolean[] };

export type GameApi = {
  check: (submission: Submission) => Promise<Verdict>;
  hint: (index: number) => Promise<string>;
};

export function gameApi(ctx: GameCompletionContext | undefined, gameIndex: number): GameApi {
  if (!ctx) {
    const unavailable = () => Promise.reject(new Error("This game is not part of a lesson"));
    return { check: unavailable, hint: unavailable };
  }
  const handleError = (error: unknown): never => {
    if (error instanceof TRPCClientError && error.data?.code === "CONFLICT") ctx.onStale?.();
    throw error;
  };
  return {
    check: (submission) =>
      trpc.games.check.mutate({ lessonId: ctx.lessonId, versionId: ctx.versionId, gameIndex, submission }).then((verdict) => {
        if (verdict.complete) ctx.onComplete?.();
        return verdict;
      }).catch(handleError),
    hint: async (hintIndex) => (await trpc.games.hint.query({ lessonId: ctx.lessonId, versionId: ctx.versionId, gameIndex, hintIndex }).catch(handleError)).text,
  };
}
