import type { GridProgram } from "@learnquest/ui-catalog";
import { TRPCClientError } from "@trpc/client";
import { trpc, type RouterOutputs } from "../../lib/trpc.ts";
import type { GameCompletionContext } from "../registry.ts";

export type Submission =
  | { kind: "quiz"; answers: number[] }
  | { kind: "order"; order: string[] }
  | { kind: "match"; pairs: { left: string; right: string }[] }
  | { kind: "sort"; cards: { text: string; bucket: number }[] }
  | { kind: "grid"; program: GridProgram }
  | { kind: "physics"; angle: number; speed: number };

export type GameApi = {
  check: (submission: Submission) => Promise<RouterOutputs["games"]["check"]>;
  completeWatch: () => Promise<RouterOutputs["games"]["completeWatch"]>;
  hint: (index: number) => Promise<string>;
  status: () => Promise<RouterOutputs["games"]["status"]>;
};

export type ActiveGameApi = GameApi & RouterOutputs["games"]["status"];

export function gameApi(ctx: GameCompletionContext, gameIndex: number): GameApi {
  const input = { lessonId: ctx.lessonId, versionId: ctx.versionId, gameIndex };
  const handleError = (error: unknown): never => {
    if (error instanceof TRPCClientError && error.data?.code === "CONFLICT") ctx.onStale?.();
    throw error;
  };
  return {
    status: () => trpc.games.status.query(input).catch(handleError),
    check: (submission) =>
      trpc.games.check.mutate({ ...input, submission }).then((verdict) => {
        if (verdict.complete) ctx.onComplete?.();
        return verdict;
      }).catch(handleError),
    completeWatch: () =>
      trpc.games.completeWatch.mutate(input).then((verdict) => {
        ctx.onComplete?.();
        return verdict;
      }).catch(handleError),
    hint: async (hintIndex) => (await trpc.games.hint.mutate({ ...input, hintIndex }).catch(handleError)).text,
  };
}
