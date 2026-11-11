import type { CourseData } from "../../lib/api";

type CourseLesson = Pick<CourseData["lessons"][number], "done" | "total">;

/** How many of a course's lessons the learner has finished. A lesson counts once all its parts are done, as the server counts it. */
export function courseProgress(lessons: CourseLesson[]) {
  const done = lessons.filter((l) => l.total > 0 && l.done >= l.total).length;
  return { done, total: lessons.length };
}
