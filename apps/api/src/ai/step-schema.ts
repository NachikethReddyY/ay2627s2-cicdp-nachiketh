import { z } from "zod";
import { buildTimeline, seek } from "@learnquest/player-core";

export const text = (max: number) => z.string().trim().min(1).max(max);

export const Hunk = z.object({ id: text(40), file: text(200), oldStart: z.number().int().min(1), lines: z.array(z.string().max(300)).min(1).max(60) });
export const Hint = z.object({ text: text(400), eliminate: z.number().int().min(0).max(3).optional() });
const Common = {
  title: text(100),
  prompt: text(500),
  beforeFiles: z.record(text(200), z.string().max(6000)).refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 4),
  hunks: z.array(Hunk).min(1).max(6),
  hints: z.array(Hint).min(1).max(2),
  explanations: z.object({ workedExample: text(1000), practice: text(500) }),
  concepts: z.array(text(60)).max(6).default([]),
};
export const McqStep = z.object({
  ...Common,
  kind: z.literal("mcq"),
  options: z.array(text(200)).length(4),
  answer: z.number().int().min(0).max(3),
});
export const ClozeStep = z.object({ ...Common, kind: z.literal("cloze"), answer: text(100), accepted: z.array(text(100)).max(6).default([]) });
export const Step = z.discriminatedUnion("kind", [McqStep, ClozeStep]);
export type GeneratedStep = z.infer<typeof Step>;
export type GeneratedMcqStep = z.infer<typeof McqStep>;

export function checkStep(step: GeneratedStep) {
  const tl = buildTimeline([{ beforeFiles: step.beforeFiles, hunks: step.hunks }]);
  const after = seek(tl, tl.duration).files;
  if (JSON.stringify(after) === JSON.stringify(step.beforeFiles)) throw new Error(`step "${step.title}" changes nothing`);
  if (step.kind === "mcq" && step.hints.some((h) => h.eliminate === step.answer))
    throw new Error(`step "${step.title}": bad eliminate`);
}
