import { env } from "../env.ts";
import { callEngine } from "../engine-client/client.ts";

export type LessonContext = {
  path: { title: string; tagline: string };
  course: { title: string; description: string };
  lesson: { title: string; objective?: string; level: number; concepts: string[]; kind: "predict" | "learn" | "watch" | "practice" | "game-practice" | "scrim" };
  missedConcepts: string[];
  stretchTests?: number;
};

export type LearnerMemory = { focusConcepts: string[] };

export const generator = {
  outline: (topic: string, learnerMemory: LearnerMemory): Promise<unknown> =>
    callEngine<{ outline?: unknown }>("/v1/pipeline/outline", { topic, learnerMemory }, { timeoutMs: env.OUTLINE_TIMEOUT_MS }).then((r) => r.outline),
  lesson: (ctx: LessonContext): Promise<unknown> => callEngine<{ lesson?: unknown }>("/v1/pipeline/lesson", ctx).then((r) => r.lesson),
};
