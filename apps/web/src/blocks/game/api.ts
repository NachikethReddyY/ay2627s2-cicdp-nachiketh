import type { GridProgram } from "@learnquest/ui-catalog";
import { trpc } from "../../lib/trpc.ts";
import type { GameCompletionContext } from "../registry.ts";

/** What a game sends to games.check. Grading happens on the server; the browser never holds an answer. */
export type Submission =
  | { kind: "quiz"; answers: number[] }
  | { kind: "order"; order: string[] }
  | { kind: "match"; pairs: { left: string; right: string }[] }
  | { kind: "sort"; cards: { text: string; bucket: number }[] }
  | { kind: "grid"; program: GridProgram }
  | { kind: "physics"; angle: number; speed: number };

export type Verdict = { correct: boolean; complete: boolean; questionResults?: boolean[] };

/** The two server calls a game view makes. `complete` in a verdict is the server recording the win. */
export type GameApi = {
  check: (submission: Submission) => Promise<Verdict>;
  hint: (index: number) => Promise<string>;
};

export function gameApi(ctx: GameCompletionContext | undefined, gameIndex: number): GameApi {
  if (!ctx) {
    const unavailable = () => Promise.reject(new Error("This game is not part of a lesson"));
    return { check: unavailable, hint: unavailable };
  }
  return {
    check: (submission) =>
      trpc.games.check.mutate({ lessonId: ctx.lessonId, gameIndex, submission }).then((verdict) => {
        if (verdict.complete) ctx.onComplete?.(); // the server has just recorded the win
        return verdict;
      }),
    hint: async (hintIndex) => (await trpc.games.hint.query({ lessonId: ctx.lessonId, gameIndex, hintIndex })).text,
  };
}
