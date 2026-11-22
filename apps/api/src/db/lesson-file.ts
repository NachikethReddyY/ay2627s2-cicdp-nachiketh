import { z } from "zod";
import { ScrimContent } from "../parts/scrim-schema.ts";

const Hunk = z.object({ id: z.string(), file: z.string(), oldStart: z.number().int(), lines: z.array(z.string()) });

const Hint = z.object({ text: z.string().min(1), eliminate: z.number().int().min(0).optional() });

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
      else if (options.length > 4) ctx.addIssue({ code: "custom", message: "mcq allows at most 4 options" });
      else if (typeof answer !== "number" || answer < 0 || answer >= options.length)
        ctx.addIssue({ code: "custom", message: "mcq answer must be an option index" });
    } else if (typeof answer !== "string" || !accepted?.length) {
      ctx.addIssue({ code: "custom", message: "cloze needs a string answer and accepted variants" });
    }
  });

export const LessonFile = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: z.string().min(1),
    concepts: z.array(z.string()),
    position: z.number().int().min(0),
    status: z.enum(["draft", "published"]).default("published"),
    source: z.object({ repo: z.string(), sha: z.string(), path: z.string() }).optional(),
    steps: z.array(LessonStepFile).min(1),
    scrim: ScrimContent.optional(),
  })
  .superRefine((file, ctx) => {
    if (!file.scrim) return;
    const gated = new Set(file.scrim.segments.flatMap((segment) => (segment.gate === undefined ? [] : [segment.gate])));
    file.steps.forEach((_step, idx) => {
      if (!gated.has(idx)) ctx.addIssue({ code: "custom", path: ["steps", idx], message: `step ${idx} has no gate segment in the scrim` });
    });
    file.scrim.segments.forEach((segment, idx) => {
      if (segment.gate === undefined) return;
      const step = file.steps[segment.gate];
      if (!step) ctx.addIssue({ code: "custom", path: ["scrim", "segments", idx, "gate"], message: `gate ${segment.gate} has no step in this lesson` });
      else if (step.public.kind !== "mcq") ctx.addIssue({ code: "custom", path: ["scrim", "segments", idx, "gate"], message: `gate ${segment.gate} must be a multiple-choice step` });
    });
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

export function assertUniqueAcrossFiles(files: LessonFile[]) {
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const f of files) {
    if (slugs.has(f.slug)) throw new Error(`Duplicate lesson slug: ${f.slug}`);
    slugs.add(f.slug);
    for (const [idx, s] of f.steps.entries()) {
      const id = s.id ?? `${f.slug}-${idx}`;
      if (ids.has(id)) throw new Error(`Duplicate step id: ${id} (lesson ${f.slug})`);
      ids.add(id);
    }
  }
}

type FileHunk = { file: string; oldStart: number; lines: string[] };

export function applyHunks(files: Record<string, string>, hunks: FileHunk[]) {
  const out = { ...files };
  for (const h of hunks) {
    const text = out[h.file];
    if (text === undefined) throw new Error(`hunk targets ${h.file}, which is not in beforeFiles`);
    const src = text.split("\n");
    const body: string[] = [];
    let pos = h.oldStart - 1;
    for (const l of h.lines) {
      const line = l.slice(1);
      if (l[0] === "+") body.push(line);
      else {
        if (src[pos] !== line) throw new Error(`hunk does not apply to ${h.file} at line ${pos + 1}`);
        pos++;
        if (l[0] === " ") body.push(line);
      }
    }
    out[h.file] = [...src.slice(0, h.oldStart - 1), ...body, ...src.slice(pos)].join("\n");
  }
  return out;
}

export function assertHunksApply(file: LessonFile) {
  for (const [idx, s] of file.steps.entries()) {
    try {
      applyHunks(s.secret.beforeFiles, s.secret.hunks);
    } catch (e) {
      throw new Error(`${file.slug} step ${s.id ?? `${file.slug}-${idx}`}: ${(e as Error).message}`, { cause: e });
    }
  }
}
