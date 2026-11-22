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

type LeakCheckStep = {
  title: string;
  prompt: string;
  hints: ReadonlyArray<{ text: string }>;
  explanations: { workedExample: string; practice: string };
  answer: number | string;
  options?: ReadonlyArray<string>;
  accepted?: ReadonlyArray<string>;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function answerLeaks(step: LeakCheckStep): boolean {
  const answers = step.options
    ? [step.options[typeof step.answer === "number" ? step.answer : Number(step.answer)] ?? ""]
    : [String(step.answer), ...(step.accepted ?? []).map(String)];
  const haystack = [
    step.title,
    step.prompt,
    step.explanations.workedExample,
    step.explanations.practice,
    ...step.hints.map((h) => h.text),
  ].map(norm);
  return answers.some((raw) => {
    const a = norm(raw);
    return a.length >= 3 && haystack.some((h) => h.includes(a));
  });
}

const leakMessage = (step: LeakCheckStep) =>
  `step "${step.title}": hints, title, prompt or explanations leak the answer`;

function noLeak(step: LeakCheckStep, ctx: z.RefinementCtx) {
  if (answerLeaks(step)) ctx.addIssue({ code: "custom", message: leakMessage(step) });
}

export const McqStep = z.object({
  ...Common,
  kind: z.literal("mcq"),
  options: z.array(text(200)).length(4),
  answer: z.number().int().min(0).max(3),
}).superRefine(noLeak);
export const ClozeStep = z.object({ ...Common, kind: z.literal("cloze"), answer: text(100), accepted: z.array(text(100)).max(6).default([]) }).superRefine(noLeak);
export const Step = z.discriminatedUnion("kind", [McqStep, ClozeStep]);
export type GeneratedStep = z.infer<typeof Step>;
export type GeneratedMcqStep = z.infer<typeof McqStep>;

export function checkStep(step: GeneratedStep) {
  if (answerLeaks(step)) throw new Error(leakMessage(step));
  const tl = buildTimeline([{ beforeFiles: step.beforeFiles, hunks: step.hunks }]);
  const after = seek(tl, tl.duration).files;
  if (JSON.stringify(after) === JSON.stringify(step.beforeFiles)) throw new Error(`step "${step.title}" changes nothing`);
  if (step.kind === "mcq" && step.hints.some((h) => h.eliminate === step.answer))
    throw new Error(`step "${step.title}": bad eliminate`);
}
