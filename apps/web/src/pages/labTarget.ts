import type { Part } from "../player/live/types";

export type LabPart = Extract<Part, { kind: "practice" }>;

export type LabTarget = { part: LabPart; origin: "practice" | "scrim" } | { error: string };

type LessonLike = { kind?: string; part: Part | null } | null | undefined;

export function labTarget(lesson: LessonLike): LabTarget {
  const part = lesson?.part;
  if (!part) return { error: lesson?.kind ? `This lesson is a ${lesson.kind} lesson, so it has no lab.` : "This lesson has no content." };
  if (part.kind === "practice") return { part, origin: "practice" };
  if (part.kind === "scrim") return { part: part.lab, origin: "scrim" };
  return { error: `This lesson is a ${part.kind} lesson, so it has no lab.` };
}
