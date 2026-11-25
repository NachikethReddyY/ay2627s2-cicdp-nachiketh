import { callEngine } from "./client.ts";

export type PartContext = {
  path: { title: string; tagline: string };
  course: { title: string; description: string };
  lesson: { title: string; objective?: string; level: number; concepts: string[]; kind: string };
  missedConcepts: string[];
  stretchTests?: number;
};

export const engineParts = {
  lesson: async (ctx: PartContext): Promise<unknown> => {
    const body = await callEngine<{ lesson?: unknown }>("/v1/pipeline/lesson", ctx);
    return body.lesson;
  },
};
