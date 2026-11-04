import { z } from "zod";
import type { Issue } from "../../core/parse.ts";
import type { GameKind } from "./shell.ts";

export const MIN_QUIZ_QUESTIONS = 1;
export const MAX_QUIZ_QUESTIONS = 10;
export const MIN_QUIZ_OPTIONS = 2;
export const MAX_QUIZ_OPTIONS = 4;

export type QuizQuestion = { prompt: string; options: string[]; answer: number };
export type QuizProps = { kind: "quiz"; questions: QuizQuestion[] };

const questionSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(240),
  options: z.array(z.string().trim().min(1).max(120)).min(MIN_QUIZ_OPTIONS).max(MAX_QUIZ_OPTIONS),
  answer: z.int().min(0).max(MAX_QUIZ_OPTIONS - 1),
});

const schema = z.strictObject({
  kind: z.literal("quiz"),
  questions: z.array(questionSchema).min(MIN_QUIZ_QUESTIONS).max(MAX_QUIZ_QUESTIONS),
}) satisfies z.ZodType<QuizProps>;

function check(p: QuizProps): Issue[] {
  const issues: Issue[] = [];
  p.questions.forEach((q, i) => {
    if (q.answer >= q.options.length) issues.push({ path: `questions.${i}.answer`, message: "answer must point to one of this question's options" });
    if (new Set(q.options.map((option) => option.toLocaleLowerCase())).size !== q.options.length)
      issues.push({ path: `questions.${i}.options`, message: "options must be distinct" });
  });
  return issues;
}

export const quizKind: GameKind<QuizProps> = {
  schema,
  check,
  describe: ({ questions }) => `a ${questions.length}-question multiple-choice quiz`,
};
