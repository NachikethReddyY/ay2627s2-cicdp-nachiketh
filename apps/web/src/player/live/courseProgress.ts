import type { CourseData } from "../../lib/api";

type CourseLesson = Pick<CourseData["lessons"][number], "done" | "total">;

/** How many of a course's lessons the learner has finished. A lesson counts once all its parts are done, as the server counts it. */
export function courseProgress(lessons: CourseLesson[]) {
  const done = lessons.filter((l) => l.total > 0 && l.done >= l.total).length;
  return { done, total: lessons.length };
}

/** The title of the lesson with this slug, so a lesson that is still being written can be named. Undefined when it is not in the course. */
export function lessonTitle(lessons: Pick<CourseData["lessons"][number], "slug" | "title">[], slug: string) {
  return lessons.find((l) => l.slug === slug)?.title;
}
