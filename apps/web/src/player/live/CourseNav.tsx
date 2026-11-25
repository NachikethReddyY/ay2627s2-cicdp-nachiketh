import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Bar } from "../../components/Bits";
import { useApi, type ApiState, type CourseData } from "../../lib/api";
import { trpc } from "../../lib/trpc";
import { courseProgress } from "./courseProgress";
import { isInAppLinkClick, useContinueAnalytics } from "./lessonAnalytics";

export type CourseState = ApiState<CourseData | null>;

export const NextLink = ({ href, action, children }: { href: string; action?: "lesson" | "assess" | "review"; children: ReactNode }) => {
  const router = useRouter();
  const captureContinue = useContinueAnalytics("lesson_end");
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isInAppLinkClick(e)) return;
    e.preventDefault();
    router.history.push(href, action === "lesson" || action === "assess" ? { lessonEntrySource: "lesson_end" } : undefined);
    if (action) captureContinue(action);
  };
  return <a href={href} onClick={go} className="btn mt-4">{children}</a>;
};

export function LessonProgress({ id, course, inline }: { id: string; course: CourseState; inline?: boolean }) {
  const data = course.data;
  const i = data?.lessons.findIndex((l) => l.slug === id) ?? -1;
  if (!data || i < 0) return null;
  const { done, total } = courseProgress(data.lessons);
  return (
    <div className={inline ? "pb-4" : "sticky top-0 z-30 px-4 pt-3 pb-2 border-b border-[var(--line)] bg-[var(--glass)] backdrop-blur-xl"}>
      <div className="mx-auto max-w-3xl">
        <Bar value={done} total={total} label="Course progress" />
      </div>
    </div>
  );
}

export function CourseNext({ id, slug, path, course }: { id: string; slug: string; path?: string; course: CourseState }) {
  const rec = useApi(`me.next:${slug}`, () => trpc.me.next.query({ world: slug }));
  const { data, error } = course;
  if (error) return <NextLink href={`/courses/${slug}`}>Back to course</NextLink>;
  if (!data || rec.loading) return <button type="button" disabled className="btn mt-4 opacity-50">Next</button>;
  const i = data.lessons.findIndex((l) => l.slug === id);
  const recommended = rec.data?.lessonSlug && rec.data.lessonSlug !== id ? rec.data.lessonSlug : null;
  const fallback = data.lessons.slice(i + 1).find((l) => l.missingPrerequisites.length === 0 && l.done < l.total);
  const next = recommended ?? (rec.error || (rec.data === null && !rec.loading) ? fallback?.slug : undefined);
  const roadmap = path ? `/paths/${path}#${slug}` : null;
  return (
    <div className="flex flex-col items-center text-center">
      {rec.data && <p className="mt-4 mb-0 text-sm text-[var(--mu)]">{rec.data.reason}</p>}
      {rec.data?.action === "review"
        ? <NextLink href={`/review/${slug}`} action="review">Review</NextLink>
        : next ? <NextLink href={`/lessons?lesson=${next}&course=${slug}${path ? `&path=${path}` : ""}`} action={rec.data?.action === "assess" ? "assess" : "lesson"}>Next</NextLink>
          : data.nextSection && path
            ? <NextLink href={`/courses/${data.nextSection}?path=${path}`}>Next section</NextLink>
            : !roadmap && <NextLink href={`/courses/${slug}`}>Back to course</NextLink>}
      {roadmap && <NextLink href={roadmap}>Back to roadmap</NextLink>}
    </div>
  );
}
