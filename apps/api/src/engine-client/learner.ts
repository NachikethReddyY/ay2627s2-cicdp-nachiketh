import { z } from "zod";
import { callEngine } from "./client.ts";

/** World-tunable BKT parameters. pGuess is not sent: the engine picks it by question type. */
export type BktParams = { pSlip: number; pLearn: number; pInit: number };

export type UpdateRequest = {
  priors: { conceptId: string; pKnown: number | null }[];
  params?: BktParams;
  questionType: "mcq" | "cloze";
  correct: boolean;
};
const UpdateResponse = z.object({
  updates: z.array(z.object({ conceptId: z.string(), pPosterior: z.number(), pNext: z.number() })),
});

export type NextRequest = {
  mastery: { conceptId: string; pKnown: number }[];
  edges: [string, string][];
  lessons: { lessonId: string; title?: string; conceptIds: string[]; kind: string; done: boolean; order: number }[];
  worldTitle?: string;
  unlockAt?: number;
  masteredAt?: number;
};
export const ACTIONS = ["start", "learn", "practice", "advance", "done"] as const;
const NextResponse = z.object({
  action: z.enum(ACTIONS),
  lessonId: z.string().nullable(),
  conceptId: z.string().nullable(),
  reasonCode: z.string().min(1),
  reason: z.string().min(1),
});
export type NextResult = z.infer<typeof NextResponse>;

// Test seam, like `engineParts` in parts.ts: tests replace `update` and `next` to avoid the engine.
export const engineLearner = {
  /** BKT update for the concepts of one observed attempt. */
  update: async (req: UpdateRequest, opts?: { timeoutMs?: number }) =>
    UpdateResponse.parse(await callEngine("/v1/mastery/update", req, opts)).updates,
  /** The next-step recommendation, always with a reason. */
  next: async (req: NextRequest, opts?: { timeoutMs?: number }): Promise<NextResult> =>
    NextResponse.parse(await callEngine("/v1/next", req, opts)),
};
