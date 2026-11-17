import type { RouterOutputs } from "@/lib/trpc";
import type { TestLanguage } from "./testEditorFixture";

export type TestEditorLesson = { instructions: string; language: TestLanguage } | { error: string };

// Tied to the router's output, so a renamed field or a new part kind fails the type check here.
type LessonLike = Pick<RouterOutputs["lessons"]["get"], "part"> | null | undefined;

const LANGUAGES: readonly string[] = ["javascript", "typescript", "python"];

export function testEditorLesson(lesson: LessonLike): TestEditorLesson {
  const part = lesson?.part;
  if (!part) return { error: "This lesson has no content." };
  if (part.kind !== "practice") return { error: `This lesson is a ${part.kind} lesson, not a practice lesson.` };
  const language = LANGUAGES.includes(part.language ?? "") ? (part.language as TestLanguage) : "javascript";
  return { instructions: part.instructions, language };
}
