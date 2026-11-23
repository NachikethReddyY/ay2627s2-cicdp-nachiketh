import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Bar } from "../../components/Bits";
import { useApi, type ApiState, type CourseData } from "../../lib/api";
import { trpc } from "../../lib/trpc";
import { courseProgress } from "./courseProgress";

export type CourseState = ApiState<CourseData | null>;

export const NextLink = ({ href, children }: { href: string; children: ReactNode }) => {
  const router = useRouter();
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.history.push(href);
  };
  return <a href={href} onClick={go} className="btn mt-4">{children}</a>;
};

export function LessonProgress({ id, course }: { id: string; course: CourseState }) {
  const data = course.data;
  const i = data?.lessons.findIndex((l) => l.slug === id) ?? -1;
  if (!data || i < 0) return null;
  const { done, total } = courseProgress(data.lessons);
  return (
    <div className="sticky top-0 z-30 px-4 pt-3 pb-2 border-b border-[var(--line)] bg-[var(--glass)] backdrop-blur-xl">
      <div className="mx-auto max-w-3xl">
        <Bar value={done} total={total} label="Course progress" />
      </div>
    </div>
  );
}

export function CourseNext({ id, slug, course }: { id: string; slug: string; course: CourseState }) {
  const rec = useApi(`me.next:${slug}`, () => trpc.me.next.query({ world: slug }));
  const { data, error } = course;
  if (error) return <NextLink href={`/courses/${slug}`}>Back to course</NextLink>;
  if (!data || rec.loading) return <button type="button" disabled className="btn mt-4 opacity-50">Next</button>;
  const i = data.lessons.findIndex((l) => l.slug === id);
  const recommended = rec.data?.lessonSlug && rec.data.lessonSlug !== id ? rec.data.lessonSlug : null;
  const fallback = data.lessons.slice(i + 1).find((l) => l.missingPrerequisites.length === 0 && l.done < l.total);
  const next = recommended ?? (rec.error || (rec.data === null && !rec.loading) ? fallback?.slug : undefined);
  return (
    <div className="flex flex-col items-center text-center">
      {rec.data && <p className="mt-4 mb-0 text-sm text-[var(--mu)]">{rec.data.reason}</p>}
      {rec.data?.action === "review"
        ? <NextLink href={`/review/${slug}`}>Review</NextLink>
        : next ? <NextLink href={`/play?lesson=${next}&course=${slug}`}>Next</NextLink>
          : <NextLink href={`/courses/${slug}`}>Back to course</NextLink>}
    </div>
  );
}
