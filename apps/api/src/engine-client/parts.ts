import { callEngine } from "./client.ts";

/** What the engine needs to write one non-predict part. The shape matches services/engine's LessonContext. */
export type PartContext = {
  path: { title: string; tagline: string };
  course: { title: string; description: string };
  lesson: { title: string; level: number; concepts: string[]; kind: string };
  missedConcepts: string[];
};

// Test seam, like `generator` in ai/generator.ts: tests replace `lesson` to avoid the engine.
export const engineParts = {
  /** Returns the engine's raw part; the caller validates it with visuals/gate.ts. */
  lesson: async (ctx: PartContext): Promise<unknown> => {
    // Parts are cached across learners, so the personal miss list is never sent for them.
    const body = await callEngine<{ lesson?: unknown }>("/v1/pipeline/lesson", { ...ctx, missedConcepts: [] });
    return body.lesson;
  },
};
