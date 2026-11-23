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
  concepts: z.array(text(60)).min(1).max(6),
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

function answerLeaks(step: GeneratedMcqStep): boolean {
  const surfaces = [
    step.title,
    step.prompt,
    step.explanations.workedExample,
    step.explanations.practice,
    ...step.hints.map((h) => h.text),
    ...step.concepts,
  ];
  return surfaces.some((surface) => containsMcqOption(surface, step.options[step.answer]!));
}

const leakMessage = (step: GeneratedMcqStep) =>
  `step "${step.title}": hints, title, prompt, explanations or concept tags leak the answer`;

const Mcq = z.object({
  ...Common,
  kind: z.literal("mcq"),
  options: z.array(text(200)).length(4),
  answer: z.number().int().min(0).max(3),
});
export type GeneratedMcqStep = z.infer<typeof Mcq>;

export const McqStep = Mcq.superRefine((step, ctx) => {
  if (answerLeaks(step)) ctx.addIssue({ code: "custom", message: leakMessage(step) });
});

const hiddenChange = /\b(?:the|this|that)\s+(?:(?:hidden|next|proposed|upcoming)\s+)?(?:diffs?|patch(?:es)?|hunks?|reveal|changes?|edits?|updates?)\b/i;

function quotesNewCode(step: GeneratedMcqStep): boolean {
  const starter = Object.values(step.beforeFiles);
  return step.hunks.some(({ lines }) => lines.some((line) => {
    if (!line.startsWith("+")) return false;
    const code = line.slice(1).trim();
    return code.length >= 4 && step.prompt.includes(code) && !starter.some((file) => file.includes(code));
  }));
}

export const PredictStep = Mcq.extend({ scenario: text(300) })
  .transform(({ scenario, ...step }) => ({ ...step, prompt: `${scenario} ${step.prompt}` }))
  .superRefine((step, ctx) => {
    if (hiddenChange.test(step.prompt)) {
      ctx.addIssue({ code: "custom", path: ["prompt"], message: "State the specific change or input instead of referring to a hidden edit" });
    }
    if (quotesNewCode(step)) {
      ctx.addIssue({ code: "custom", path: ["prompt"], message: "Describe the change in plain language without quoting newly added source lines" });
    }
    if (answerLeaks(step)) ctx.addIssue({ code: "custom", message: leakMessage(step) });
  });

export function checkStep(step: GeneratedMcqStep) {
  const tl = buildTimeline([{ beforeFiles: step.beforeFiles, hunks: step.hunks }]);
  const after = seek(tl, tl.duration).files;
  if (JSON.stringify(after) === JSON.stringify(step.beforeFiles)) throw new Error(`step "${step.title}" changes nothing`);
  if (step.hints.some((h) => h.eliminate === step.answer))
    throw new Error(`step "${step.title}": bad eliminate`);
}
