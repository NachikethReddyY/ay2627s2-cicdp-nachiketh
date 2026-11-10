import { z } from "zod";

const Hunk = z.object({ id: z.string(), file: z.string(), oldStart: z.number().int(), lines: z.array(z.string()) });

const Hint = z.object({ text: z.string().min(1), eliminate: z.number().int().min(0).optional() });

// Everything the learner must not see before reveal lives under `secret`, narration text included.
const StepSecretFile = z.object({
  beforeFiles: z.record(z.string(), z.string()),
  hunks: z.array(Hunk).min(1),
  answer: z.union([z.number().int(), z.string()]),
  accepted: z.array(z.string()).optional(),
  hints: z.array(Hint),
  explanations: z.object({ workedExample: z.string(), practice: z.string() }),
  narration: z.string().min(1).optional(),
});

const StepPublicFile = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  kind: z.enum(["mcq", "cloze"]),
  options: z.array(z.string()).optional(),
});

const LessonStepFile = z
  .object({ id: z.string().min(1).optional(), public: StepPublicFile, secret: StepSecretFile })
  .superRefine((s, ctx) => {
    const { kind, options } = s.public;
    const { answer, accepted } = s.secret;
    if (kind === "mcq") {
      if (!options || options.length < 2) ctx.addIssue({ code: "custom", message: "mcq needs options" });
      else if (typeof answer !== "number" || answer < 0 || answer >= options.length)
        ctx.addIssue({ code: "custom", message: "mcq answer must be an option index" });
    } else if (typeof answer !== "string" || !accepted?.length) {
      ctx.addIssue({ code: "custom", message: "cloze needs a string answer and accepted variants" });
    }
  });

export const LessonFile = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  // Concept names; each must exist in the manifest.
  concepts: z.array(z.string()),
  position: z.number().int().min(0),
  // Drafts are seeded but not published; a human author approves before publish.
  status: z.enum(["draft", "published"]).default("published"),
  source: z.object({ repo: z.string(), sha: z.string(), path: z.string() }).optional(),
  steps: z.array(LessonStepFile).min(1),
});
export type LessonFile = z.infer<typeof LessonFile>;

export const Manifest = z.object({
  slug: z.string().min(1),
  title: z.string(),
  description: z.string().default(""),
  path: z.string().min(1),
  concepts: z.array(z.object({ slug: z.string().min(1), name: z.string().min(1) })),
});
export type Manifest = z.infer<typeof Manifest>;
