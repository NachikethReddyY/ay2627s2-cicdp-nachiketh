import type { CourseData } from "../../lib/api";

export type WriteState = CourseData["lessons"][number]["writeState"];

export const writeLabel: Record<WriteState, string | null> = {
  ready: null,
  writing: "Writing…",
  failed: "Couldn't write",
  pending: "Not written yet",
};

export function writeProgress(lessons: readonly { writeState: WriteState }[]) {
  const count = (state: WriteState) => lessons.filter((l) => l.writeState === state).length;
  return { total: lessons.length, ready: count("ready"), writing: count("writing"), failed: count("failed"), pending: count("pending") };
}
