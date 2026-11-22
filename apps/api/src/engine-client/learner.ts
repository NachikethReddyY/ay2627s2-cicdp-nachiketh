import { z } from "zod";
import { callEngine } from "./client.ts";

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
  policyVersion: z.string().min(1),
  action: z.enum(ACTIONS),
  lessonId: z.string().nullable(),
  conceptId: z.string().nullable(),
  reasonCode: z.string().min(1),
  reason: z.string().min(1),
});
export type NextResult = z.infer<typeof NextResponse>;

export const engineLearner = {
  update: async (req: UpdateRequest, opts?: { timeoutMs?: number }) =>
    UpdateResponse.parse(await callEngine("/v1/mastery/update", req, opts)).updates,
  next: async (req: NextRequest, opts?: { timeoutMs?: number }): Promise<NextResult> =>
    NextResponse.parse(await callEngine("/v1/next", req, opts)),
};
