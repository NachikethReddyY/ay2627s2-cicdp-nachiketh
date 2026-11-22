import { Suspense, lazy, useEffect, useState } from "react";
import { trpc, trpcUnbatched, isNotFound } from "../lib/trpc";
import { useApi } from "../lib/api";
import { LearnView } from "./LearnView.tsx";
import { GamePracticeView } from "./GamePracticeView.tsx";
import { CourseNext, LessonProgress, NextLink } from "./live/CourseNav";
import { Notice } from "./live/Notice";
import Steps from "./live/Steps";
import WatchView from "./live/WatchView";
import { lessonTitle } from "./live/courseProgress";

const LessonWorkbench = lazy(() => import("./live/LessonWorkbench"));
const ScrimLesson = lazy(() => import("./scrim/ScrimLesson"));

export default function LiveLesson({ slug, course }: { slug: string; course?: string }) {
  const { data, error, reload } = useApi(`lesson:${slug}`, () => trpc.lessons.get.query({ id: slug }));
  const courseState = useApi(`course:${course ?? ""}`, () => (course ? trpcUnbatched.courses.get.query({ slug: course }) : Promise.resolve(null)));
  const [slow, setSlow] = useState(false);
  const loading = !data && !error;
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(t);
  }, [loading]);
  const readKind = data?.kind === "learn" || data?.kind === "watch";
  const lessonId = data?.id;
  const reloadCourse = courseState.reload;
  useEffect(() => {
    if (lessonId && readKind) void trpc.parts.complete.mutate({ lessonId }).then(reloadCourse, () => {});
  }, [lessonId, readKind, reloadCourse]);

  if (error)
    return (
      <Notice>
        {isNotFound(error) ? "We couldn't find that lesson." : "We couldn't write this lesson."}{" "}
        {!isNotFound(error) && <button type="button" className="pill px-3 py-1 text-sm" onClick={reload}>Try again</button>}{" "}
        <a href="/" className="underline">Home</a>
      </Notice>
    );
  if (!data) {
    const title = courseState.data ? lessonTitle(courseState.data.lessons, slug) : undefined;
    return (
      <Notice>
        <p>{slow ? "Writing this lesson…" : "Loading lesson…"}</p>
        {title && <p className="mt-1 text-sm font-normal">Up next: {title}</p>}
        <div className="mt-3 h-3 w-64 max-w-full overflow-hidden track" aria-hidden="true">
          <div className="sketch h-full w-1/3 rounded-full bg-blue" />
        </div>
      </Notice>
    );
  }
  const next = (
    <div className="flex justify-center">{course ? <CourseNext id={data.id} slug={course} course={courseState} /> : <NextLink href="/">Back home</NextLink>}</div>
  );
  const { part } = data;
  const progress = course ? <LessonProgress id={data.id} course={courseState} /> : null;
  const fallback = <Notice><p>Loading lesson…</p></Notice>;
  if (data.kind === "learn" && part?.kind === "learn")
    return <div className="lq lq-moon flex h-dvh flex-col"><LearnView title={data.title} body={part.body} doc={part.doc} next={next} /></div>;
  if (data.kind === "watch" && part?.kind === "watch")
    return <Suspense fallback={fallback}><WatchView title={data.title} part={part} next={next} /></Suspense>;
  if (data.kind === "practice" && part?.kind === "practice")
    return <Suspense fallback={fallback}><LessonWorkbench lessonId={data.id} title={data.title} part={part} next={next} /></Suspense>;
  if (data.kind === "scrim" && part?.kind === "scrim")
    return <Suspense fallback={fallback}><ScrimLesson lessonId={data.id} title={data.title} part={part} steps={data.steps} media={data.media} next={next} /></Suspense>;
  if (data.kind === "game-practice" && part?.kind === "game-practice")
    return <div className="flex h-dvh flex-col">{progress}<GamePracticeView lessonId={data.id} versionId={part.versionId} title={data.title} intro={part.intro} doc={part.doc} next={next} onComplete={courseState.reload} /></div>;
  if (data.kind === "predict" && data.steps.length > 0)
    return <>{progress}<Suspense fallback={fallback}><Steps lesson={data} next={next} onFinished={courseState.reload} /></Suspense></>;
  return (
    <Notice>
      This lesson isn't ready yet.{" "}
      <button type="button" className="pill px-3 py-1 text-sm" onClick={reload}>Try again</button>{" "}
      <a href="/" className="underline">Home</a>
    </Notice>
  );
}
