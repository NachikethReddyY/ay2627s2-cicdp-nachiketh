import { Suspense, lazy, useEffect, useState } from "react";
import { trpc, isNotFound } from "../lib/trpc";
import { useApi } from "../lib/api";
import { LearnView } from "./LearnView.tsx";
import { GamePracticeView } from "./GamePracticeView.tsx";
import { CourseNext, LessonProgress, NextLink } from "./live/CourseNav";
import { Notice } from "./live/Notice";
import Steps from "./live/Steps";
import WatchView from "./live/WatchView";

// Practice embeds the code editor (Monaco), so it loads on demand with the player.
const PracticeView = lazy(() => import("./live/PracticeView"));

export default function LiveLesson({ slug, course }: { slug: string; course?: string }) {
  const { data, error, reload } = useApi(`lesson:${slug}`, () => trpc.lessons.get.query({ id: slug }));
  // One course fetch serves both the progress strip and the Next button.
  const courseState = useApi(`course:${course ?? ""}`, () => (course ? trpc.courses.get.query({ slug: course }) : Promise.resolve(null)));
  // lessons.get waits while an AI lesson is written; say so once it takes a moment. Only while still waiting, so a loaded lesson never re-renders for it.
  const [slow, setSlow] = useState(false);
  const loading = !data && !error;
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(t);
  }, [loading]);
  // Reading or watching a part counts it as finished; practice and games are completed server-side. Errors are ignored.
  const readKind = data?.kind === "learn" || data?.kind === "watch";
  const lessonId = data?.id;
  // Once the part is marked done, refetch the course so the progress strip counts it.
  const reloadCourse = courseState.reload;
  useEffect(() => {
    if (lessonId && readKind) void trpc.parts.complete.mutate({ lessonId }).then(reloadCourse, () => {});
  }, [lessonId, readKind, reloadCourse]);

  if (error)
    return (
      <Notice pip="pip-oops">
        {isNotFound(error) ? "We couldn't find that lesson." : "Pip couldn't write this lesson."}{" "}
        {!isNotFound(error) && <button type="button" className="pill bg-white px-3 py-1 text-sm" onClick={reload}>Try again</button>}{" "}
        <a href="/" className="underline">Home</a>
      </Notice>
    );
  if (!data)
    return (
      <Notice>
        <p>{slow ? "Pip is writing your next lesson…" : "Loading lesson…"}</p>
        <div className="mt-3 h-3 w-64 max-w-full overflow-hidden rounded-full border-[3px] border-ink bg-white" aria-hidden="true">
          <div className="sketch h-full w-1/3 rounded-full bg-blue" />
        </div>
      </Notice>
    );
  const next = (
    <div className="flex justify-center">{course ? <CourseNext id={data.id} slug={course} course={courseState} /> : <NextLink href="/">Back home</NextLink>}</div>
  );
  const { part } = data;
  const progress = course ? <LessonProgress id={data.id} course={courseState} /> : null;
  // The player (and Monaco with it) loads only for the lessons that have a code window.
  const fallback = <Notice><p>Loading lesson…</p></Notice>;
  if (data.kind === "learn" && part?.kind === "learn")
    return <div className="flex h-dvh flex-col">{progress}<LearnView title={data.title} body={part.body} doc={part.doc} next={next} /></div>;
  if (data.kind === "watch" && part?.kind === "watch")
    return <Suspense fallback={fallback}><WatchView title={data.title} part={part} next={next} /></Suspense>; // codecasts: no course progress strip
  if (data.kind === "practice" && part?.kind === "practice")
    return <Suspense fallback={fallback}><PracticeView lessonId={data.id} title={data.title} part={part} next={next} /></Suspense>;
  if (data.kind === "game-practice" && part?.kind === "game-practice")
    return <div className="flex h-dvh flex-col">{progress}<GamePracticeView lessonId={data.id} title={data.title} intro={part.intro} doc={part.doc} next={next} /></div>;
  if (data.kind === "predict" && data.steps.length > 0)
    return <>{progress}<Suspense fallback={fallback}><Steps lesson={data} next={next} onFinished={courseState.reload} /></Suspense></>;
  // A part the server could not provide (no content, or content of another kind), or a predict lesson with no steps.
  return (
    <Notice pip="pip-oops">
      This lesson isn't ready yet.{" "}
      <button type="button" className="pill bg-white px-3 py-1 text-sm" onClick={reload}>Try again</button>{" "}
      <a href="/" className="underline">Home</a>
    </Notice>
  );
}
