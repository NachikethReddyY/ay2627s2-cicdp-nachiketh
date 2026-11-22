import "./helpers.ts";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { lessons, lessonVersions, steps, worlds } from "../src/db/schema.ts";
import type { Scrim } from "../src/parts/scrim-schema.ts";

export type SegmentPlan = { gate?: number; edit?: boolean };

export const segmentText = (index: number) => `SEG_TEXT_${index}`;
export const segmentCode = (index: number) => `SEG_CODE_${index}`;
export const stepCode = (gate: number) => `STEP_CODE_${gate}`;
export const secrets = (gate: number) => ({
  title: `STEP_TITLE_${gate}`,
  prompt: `STEP_PROMPT_${gate}\n\`\`\`js\n${stepCode(gate)}\n\`\`\``,
  before: `STEP_BEFORE_${gate}`,
  hint: `STEP_HINT_${gate}`,
  hunk: `STEP_HUNK_${gate}`,
  worked: `STEP_WORKED_${gate}`,
  practice: `STEP_PRACTICE_${gate}`,
  option: `STEP_OPTION_${gate}`,
});

export const lab = {
  kind: "practice",
  instructions: "Write a program that maps each input to its output.",
  language: "javascript",
  starterCode: "const input = '';",
  tests: [
    { id: "s1", name: "Sample one", visibility: "sample", stretch: false, stdin: "IN_ONE", expectedStdout: "OUT_ONE" },
    { id: "h1", name: "Hidden one", visibility: "hidden", stretch: false, stdin: "IN_HIDDEN", expectedStdout: "OUT_HIDDEN" },
  ],
} satisfies Scrim["lab"];

export function scrimOf(plan: readonly SegmentPlan[]): Scrim {
  return {
    kind: "scrim",
    language: "javascript",
    segments: plan.map((segment, index) => ({
      text: segmentText(index),
      durationMs: 1000,
      ...(segment.edit && { edit: { code: segmentCode(index), run: false } }),
      ...(segment.gate !== undefined && { gate: segment.gate }),
    })),
    lab,
  };
}

export async function insertScrimLesson(slug: string, plan: readonly SegmentPlan[]) {
  const scrim = scrimOf(plan);
  const [world] = await db.insert(worlds).values({ slug: `${slug}-world` }).returning({ id: worlds.id });
  const [lesson] = await db.insert(lessons).values({
    slug, title: slug, worldId: world.id, kind: "scrim", sourceKind: "authored", status: "published",
  }).returning({ id: lessons.id });
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson.id, version: 1, content: scrim }).returning({ id: lessonVersions.id });
  const gates = plan.flatMap((segment) => (segment.gate === undefined ? [] : [segment.gate])).sort((a, b) => a - b);
  const stepIds = new Map<number, string>();
  for (const gate of gates) {
    const s = secrets(gate);
    const [step] = await db.insert(steps).values({
      lessonVersionId: version.id,
      idx: gate,
      public: { title: s.title, kind: "mcq", prompt: s.prompt, options: ["First option", s.option, "Third option"] },
      secret: {
        answer: 1,
        hints: [{ text: s.hint, eliminate: 2 }],
        explanations: { workedExample: s.worked, practice: s.practice },
        beforeFiles: { "src/main.js": s.before },
        hunks: [{ id: `h${gate}`, file: "src/main.js", oldStart: 1, lines: [`+${s.hunk}`] }],
      },
    }).returning({ id: steps.id });
    stepIds.set(gate, step.id);
  }
  await db.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
  return { scrim, lessonId: lesson.id, versionId: version.id, worldSlug: `${slug}-world`, stepIds };
}
