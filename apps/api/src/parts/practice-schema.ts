import { z } from "zod";

export const PRACTICE_LANGUAGES = ["python", "javascript", "typescript"] as const;
export type PracticeLanguage = (typeof PRACTICE_LANGUAGES)[number];
export const MAX_TESTS = 25;
export const MAX_SAMPLE_TESTS = 2;

export const PracticeTestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  name: z.string().min(1).max(80),
  stdin: z.string().max(1000).default(""),
  expectedStdout: z.string().max(1000),
  visibility: z.enum(["sample", "hidden"]),
  stretch: z.boolean().default(false),
});
export type PracticeTest = z.output<typeof PracticeTestSchema>;

export const PracticeContent = z
  .object({
    kind: z.literal("practice"),
    instructions: z.string().min(1).max(1000),
    language: z.enum(PRACTICE_LANGUAGES).default("javascript"),
    starterCode: z.string().max(3000),
    referenceSolution: z.string().trim().min(1).max(3000).optional(),
    referenceSolutionVerified: z.literal(true).optional(),
    tests: z.array(PracticeTestSchema).min(1).max(MAX_TESTS).optional(),
    expectedOutput: z.string().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.referenceSolution === v.starterCode.trim()) ctx.addIssue({ code: "custom", path: ["referenceSolution"], message: "reference solution matches starter code" });
    if (!v.tests && v.expectedOutput === undefined) ctx.addIssue({ code: "custom", message: "tests or expectedOutput is required" });
    if (v.tests) {
      if (new Set(v.tests.map((t) => t.id)).size !== v.tests.length) ctx.addIssue({ code: "custom", path: ["tests"], message: "test ids must be unique" });
      if (v.tests.filter((t) => t.visibility === "sample").length > MAX_SAMPLE_TESTS) ctx.addIssue({ code: "custom", path: ["tests"], message: `a practice part shows at most ${MAX_SAMPLE_TESTS} sample tests; every other test must be hidden` });
      if (v.tests.every((t) => t.stretch)) ctx.addIssue({ code: "custom", path: ["tests"], message: "at least one test must be required" });
    }
  });

export type Practice = { instructions: string; language: PracticeLanguage; starterCode: string; referenceSolution?: string; referenceSolutionVerified?: true; tests: PracticeTest[] };

export function parsePractice(content: unknown): Practice | null {
  const r = PracticeContent.safeParse(content);
  if (!r.success) return null;
  const { instructions, language, starterCode, referenceSolution, referenceSolutionVerified, tests, expectedOutput } = r.data;
  return {
    instructions,
    language,
    starterCode,
    referenceSolution,
    referenceSolutionVerified,
    tests: tests ?? [{ id: "legacy", name: "Expected output", stdin: "", expectedStdout: expectedOutput!, visibility: "hidden", stretch: false }],
  };
}
