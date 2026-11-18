import type { CourseData } from "../../lib/api";

type CourseLesson = Pick<CourseData["lessons"][number], "done" | "total">;

export function courseProgress(lessons: CourseLesson[]) {
  const done = lessons.filter((l) => l.total > 0 && l.done >= l.total).length;
  return { done, total: lessons.length };
}

export function lessonTitle(lessons: Pick<CourseData["lessons"][number], "slug" | "title">[], slug: string) {
  return lessons.find((l) => l.slug === slug)?.title;
}
