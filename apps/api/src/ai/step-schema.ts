import { z } from "zod";
import { buildTimeline, seek } from "@learnquest/player-core";
import { containsAnswer } from "./answer-leak.ts";

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
  kind: "mcq" | "cloze";
  title: string;
  prompt: string;
  beforeFiles: Readonly<Record<string, string>>;
  hints: ReadonlyArray<{ text: string }>;
  explanations: { workedExample: string; practice: string };
  answer: number | string;
  options?: ReadonlyArray<string>;
  accepted?: ReadonlyArray<string>;
};

const OPTION_WHITESPACE = "\\t-\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";
const OPTION_WHITESPACE_RUN = new RegExp(`[${OPTION_WHITESPACE}]+`, "g");
const OPTION_WHITESPACE_EDGE = new RegExp(`^[${OPTION_WHITESPACE}]+|[${OPTION_WHITESPACE}]+$`, "g");
const OPTION_IDENTIFIER = /^[a-z0-9_]+$/;

function containsMcqOption(text: string, answer: string): boolean {
  const haystack = text.toLowerCase();
  const needle = answer.toLowerCase().replace(OPTION_WHITESPACE_EDGE, "");
  if (OPTION_IDENTIFIER.test(needle)) {
    return Array.from(needle).length >= 3 && new RegExp(`(?<![a-z0-9_])${needle}(?![a-z0-9_])`).test(haystack);
  }
  const squashed = needle.replace(OPTION_WHITESPACE_RUN, "");
  return Array.from(squashed).length >= 3 && haystack.replace(OPTION_WHITESPACE_RUN, "").includes(squashed);
}

function answerLeaks(step: LeakCheckStep): boolean {
  const surfaces = [
    step.title,
    step.prompt,
    step.explanations.workedExample,
    step.explanations.practice,
    ...step.hints.map((h) => h.text),
  ];
  if (step.kind === "mcq") {
    const answer = step.options?.[typeof step.answer === "number" ? step.answer : Number(step.answer)] ?? "";
    return surfaces.some((surface) => containsMcqOption(surface, answer));
  }
  const answers = [String(step.answer), ...(step.accepted ?? []).map(String)];
  return answers.some((answer) =>
    surfaces.some((surface) => containsAnswer(surface, answer)) ||
    (step.kind === "cloze" && Object.values(step.beforeFiles).some((surface) => containsAnswer(surface, answer, false))),
  );
}

const leakMessage = (step: LeakCheckStep) =>
  `step "${step.title}": hints, title, prompt, explanations or starter code leak the answer`;

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
