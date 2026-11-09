import { z } from "zod";
import { MAX_ANGLE, MIN_ANGLE, gridProgramSchema, simulate, simulateLaunch, type GameProps, type GridProps, type MatchProps, type OrderProps, type PhysicsProps, type QuizProps, type SortProps } from "@learnquest/ui-catalog";

// What a learner may submit, one shape per game kind. Grading happens here, never in the browser.
export const submissionSchema = z.discriminatedUnion("kind", [
  // One choice per question, from the first. A shorter list grades just those questions (the UI checks as it goes);
  // the game is won only when every question is answered and right.
  z.object({ kind: z.literal("quiz"), answers: z.array(z.number().int().min(0).max(9)).min(1).max(10) }),
  z.object({ kind: z.literal("order"), order: z.array(z.string().max(200)).min(1).max(20) }),
  z.object({ kind: z.literal("match"), pairs: z.array(z.object({ left: z.string().max(200), right: z.string().max(200) })).min(1).max(20) }),
  // Keyed by card text: the cards are shuffled per request, so their position is not stable between get and check.
  z.object({ kind: z.literal("sort"), cards: z.array(z.object({ text: z.string().max(200), bucket: z.number().int().min(0).max(9) })).min(1).max(20) }),
  z.object({ kind: z.literal("grid"), program: gridProgramSchema }),
  z.object({ kind: z.literal("physics"), angle: z.number().int().min(MIN_ANGLE).max(MAX_ANGLE), speed: z.number().int().min(1).max(100) }),
]);
export type Submission = z.infer<typeof submissionSchema>;

export type Verdict = { correct: boolean; complete: boolean; questionResults?: boolean[] };

/** Thrown when the submission cannot be graded against this game (wrong kind, speed out of range). The router maps it to 400. */
export class BadSubmission extends Error {}

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));

/** Grades one submission against the stored (full) game. Pure: no database, no clock. */
export function grade(game: GameProps, s: Submission): Verdict {
  const k = game.kind;
  if (k.kind !== s.kind) throw new BadSubmission(`This game is a ${k.kind}, not a ${s.kind}`);
  if (s.kind === "quiz") {
    const qs = (k as QuizProps).questions;
    if (s.answers.length > qs.length) throw new BadSubmission("More answers than questions");
    const questionResults = s.answers.map((a, i) => a === qs[i]!.answer);
    const correct = questionResults.length === qs.length && questionResults.every(Boolean);
    return { correct, complete: correct, questionResults };
  }
  if (s.kind === "order") {
    const items = (k as OrderProps).items;
    const correct = s.order.length === items.length && items.every((x, i) => x === s.order[i]);
    return { correct, complete: correct };
  }
  if (s.kind === "match") {
    const pairs = (k as MatchProps).pairs;
    const correct =
      s.pairs.length === pairs.length &&
      sameSet(s.pairs.map((p) => p.left), pairs.map((p) => p.left)) &&
      s.pairs.every((p) => pairs.find((x) => x.left === p.left)!.right === p.right);
    return { correct, complete: correct };
  }
  if (s.kind === "sort") {
    const cards = (k as SortProps).cards;
    const correct =
      s.cards.length === cards.length &&
      sameSet(s.cards.map((c) => c.text), cards.map((c) => c.text)) &&
      s.cards.every((c) => cards.find((x) => x.text === c.text)!.bucket === c.bucket);
    return { correct, complete: correct };
  }
  if (s.kind === "grid") {
    const correct = simulate(s.program, k as GridProps).ok;
    return { correct, complete: correct };
  }
  const p = k as PhysicsProps;
  if (s.speed > p.maxSpeed) throw new BadSubmission(`Speed is at most ${p.maxSpeed}`);
  const correct = simulateLaunch(p, s.angle, s.speed).hit;
  return { correct, complete: correct };
}
