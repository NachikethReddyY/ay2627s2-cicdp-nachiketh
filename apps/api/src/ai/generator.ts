import { callEngine } from "../engine-client/client.ts";

// Every LLM call goes through the Python engine (LiteLLM); the API never calls a provider itself.
// Both methods return the engine's raw, unvalidated output; service.ts validates it with zod. Tests replace the two methods on `generator`.
export type LessonContext = {
  path: { title: string; tagline: string };
  course: { title: string; description: string };
  lesson: { title: string; level: number; concepts: string[]; kind: "predict" | "learn" | "watch" | "practice" | "game-practice" };
  missedConcepts: string[];
};

export const generator = {
  outline: (topic: string): Promise<unknown> => callEngine<{ outline?: unknown }>("/v1/pipeline/outline", { topic }).then((r) => r.outline),
  lesson: (ctx: LessonContext): Promise<unknown> => callEngine<{ lesson?: unknown }>("/v1/pipeline/lesson", ctx).then((r) => r.lesson),
};
