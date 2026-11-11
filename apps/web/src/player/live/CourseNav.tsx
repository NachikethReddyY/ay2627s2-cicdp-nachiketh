import type { ReactNode } from "react";
import { Bar } from "../../components/Bits";
import type { ApiState, CourseData } from "../../lib/api";
import { courseProgress } from "./courseProgress";

/** The lesson's course, fetched once by LiveLesson and shared by the progress strip and the Next button. */
export type CourseState = ApiState<CourseData | null>;

// A plain link so the next part loads fresh; opening it is what makes the server write that part.
export const NextLink = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} className="btn mt-4 inline-block">{children}</a>;

// Where this part sits in its course, so the learner knows how many are left.
export function LessonProgress({ id, course }: { id: string; course: CourseState }) {
  const data = course.data;
  const i = data?.lessons.findIndex((l) => l.slug === id) ?? -1;
  if (!data || i < 0) return null;
  const { done, total } = courseProgress(data.lessons);
  return (
    <div className="sticky top-0 z-30 px-4 pt-3 pb-2 backdrop-blur" style={{ background: "#fff4e0" }}>
      <div className="mx-auto max-w-3xl">
        <Bar value={done} total={total} label="Course progress" />
      </div>
    </div>
  );
}

export function CourseNext({ id, slug, course }: { id: string; slug: string; course: CourseState }) {
  const { data, error } = course;
  if (error) return <NextLink href={`/courses/${slug}`}>Back to course</NextLink>;
  if (!data) return <button type="button" disabled className="btn mt-4 opacity-50">Next</button>;
  const i = data.lessons.findIndex((l) => l.slug === id);
  // Not in this course's list: do not guess a neighbour, send the learner somewhere safe.
  if (i < 0) return <NextLink href="/">Back home</NextLink>;
  const next = data.lessons[i + 1];
  return next ? <NextLink href={`/play?lesson=${next.slug}&course=${slug}`}>Next</NextLink> : <NextLink href={`/courses/${slug}`}>Back to course</NextLink>;
}
