import { z } from "zod";
import { McqStep } from "../ai/step-schema.ts";
import { PRACTICE_LANGUAGES, PracticeContent } from "./practice-schema.ts";

const ScrimFields = z.object({
  kind: z.literal("scrim"),
  language: z.enum(PRACTICE_LANGUAGES),
  segments: z.array(z.object({
    text: z.string().trim().min(1),
    durationMs: z.number().int().min(500).max(120000),
    edit: z.object({ code: z.string(), run: z.boolean() }).optional(),
    gate: z.number().int().min(0).optional(),
  })).min(1).max(20),
  lab: PracticeContent,
});

function gatesOf(segments: Array<{ gate?: number }>) {
  return segments.flatMap((segment) => segment.gate === undefined ? [] : [segment.gate]);
}

function uniqueGates(segments: Array<{ gate?: number }>, ctx: z.RefinementCtx) {
  const gates = gatesOf(segments);
  if (new Set(gates).size !== gates.length) ctx.addIssue({ code: "custom", path: ["segments"], message: "gates must be unique" });
}

export const ScrimContent = ScrimFields.superRefine((value, ctx) => uniqueGates(value.segments, ctx));

export const GeneratedScrim = ScrimFields.extend({
  steps: z.array(McqStep).min(1).max(3),
}).superRefine((value, ctx) => {
  uniqueGates(value.segments, ctx);
  const gates = new Set(gatesOf(value.segments));
  value.segments.forEach((segment, idx) => {
    if (segment.gate !== undefined && segment.gate >= value.steps.length)
      ctx.addIssue({ code: "custom", path: ["segments", idx, "gate"], message: `gate ${segment.gate} has no step` });
  });
  value.steps.forEach((_step, idx) => {
    if (!gates.has(idx)) ctx.addIssue({ code: "custom", path: ["steps", idx], message: `step ${idx} has no gate segment` });
  });
});

export type Scrim = z.output<typeof ScrimContent>;

export function parseScrim(content: unknown): Scrim | null {
  const result = ScrimContent.safeParse(content);
  return result.success ? result.data : null;
}
