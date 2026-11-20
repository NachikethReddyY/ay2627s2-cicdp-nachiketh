import { z } from "zod";
import { PRACTICE_LANGUAGES, PracticeContent } from "./practice-schema.ts";

export const ScrimContent = z.object({
  kind: z.literal("scrim"),
  language: z.enum(PRACTICE_LANGUAGES),
  segments: z.array(z.object({
    text: z.string().trim().min(1),
    durationMs: z.number().int().min(500).max(120000),
    edit: z.object({ code: z.string(), run: z.boolean() }).optional(),
    gate: z.number().int().min(0).optional(),
  })).min(1).max(20),
  lab: PracticeContent,
}).superRefine((value, ctx) => {
  const gates = value.segments.flatMap((segment) => segment.gate === undefined ? [] : [segment.gate]);
  if (new Set(gates).size !== gates.length) ctx.addIssue({ code: "custom", path: ["segments"], message: "gates must be unique" });
});

export type Scrim = z.output<typeof ScrimContent>;

export function parseScrim(content: unknown): Scrim | null {
  const result = ScrimContent.safeParse(content);
  return result.success ? result.data : null;
}
