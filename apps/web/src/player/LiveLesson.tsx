import { TRPCClientError } from "@trpc/client";
import { Link, type HistoryState } from "@tanstack/react-router";
import { Suspense, lazy, useRef, useState, type ReactNode } from "react";
import { trpc, trpcUnbatched, isNotFound } from "../lib/trpc";
import { useApi } from "../lib/api";
import { CourseNext, LessonProgress, NextLink } from "./live/CourseNav";
import { practiceMedia } from "./live/lessonWorkbenchModel";
import { Notice } from "./live/Notice";
import { hasChecks } from "./live/readFlow";
import { lessonTitle } from "./live/courseProgress";
import { useLessonAnalytics } from "./live/lessonAnalytics";
import type { Lesson } from "./live/types";

const LearnView = lazy(() => import("./LearnView").then(({ LearnView }) => ({ default: LearnView })));
const GamePracticeView = lazy(() => import("./GamePracticeView").then(({ GamePracticeView }) => ({ default: GamePracticeView })));
const CheckedLesson = lazy(() => import("./live/CheckedLesson"));
const Steps = lazy(() => import("./live/Steps"));
const WatchView = lazy(() => import("./live/WatchView"));
const LessonWorkbench = lazy(() => import("./live/LessonWorkbench"));
const ScrimLesson = lazy(() => import("./scrim/ScrimLesson"));

function isPlayable({ kind, steps, part, completed }: Lesson) {
  if (kind === "learn" || kind === "watch") return hasChecks(kind, steps) || (completed && part?.kind === kind);
  if (kind === "predict") return steps.length > 0;
  return part?.kind === kind;
}

export default function LiveLesson({ slug, course, entrySource }: { slug: string; course?: string; entrySource?: HistoryState["lessonEntrySource"] }) {
  const [writing, setWriting] = useState(false);
  const started = useRef(false);
  const analytics = useLessonAnalytics();
  const { data, error, loading: refreshing, reload } = useApi(`lesson:${slug}`, async () => {
    const input = { id: slug };
    try {
      return await trpc.lessons.get.query(input);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    setWriting(true);
    try {
      await trpc.lessons.write.mutate(input);
      return await trpc.lessons.get.query(input);
    } finally {
      setWriting(false);
    }
  }, (lesson) => {
    if (started.current || !isPlayable(lesson)) return;
    started.current = true;
    analytics.started(lesson.kind, entrySource);
  });
  const courseState = useApi(`course:${course ?? ""}`, () => (course ? trpcUnbatched.courses.get.query({ slug: course }) : Promise.resolve(null)));
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeFailed, setUpgradeFailed] = useState(false);

  if (error instanceof TRPCClientError && error.data?.code === "PRECONDITION_FAILED") {
    return (
      <Notice>
        <p>{error.message}</p>{" "}
        {course ? <Link to="/courses/$slug" params={{ slug: course }} className="underline">Back to course</Link>
          : <Link to="/" className="underline">Home</Link>}
      </Notice>
    );
  }
  if (error)
    return (
      <Notice>
        {isNotFound(error) ? "We couldn't find that lesson." : "We couldn't write this lesson."}{" "}
        {!isNotFound(error) && <button type="button" className="pill px-3 py-1 text-sm" onClick={reload}>Try again</button>}{" "}
        <Link to="/" className="underline">Home</Link>
      </Notice>
    );
  if (!data) {
    const title = courseState.data ? lessonTitle(courseState.data.lessons, slug) : undefined;
    return (
      <Notice>
        <p>{writing ? "Preparing this lesson…" : "Loading lesson…"}</p>
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
  const checked = hasChecks(data.kind, data.steps);
  const reloadChecked = () => { reload(); courseState.reload(); };
  if (data.kind === "learn" || data.kind === "watch") {
    const upgrade = async () => {
      setUpgrading(true);
      setUpgradeFailed(false);
      try {
        await trpc.lessons.upgradeReadChecks.mutate({ id: data.id, versionId: data.versionId });
      } catch {
        setUpgradeFailed(true);
      } finally {
        reload();
        setUpgrading(false);
      }
    };
    const update = data.canUpgradeReadChecks && (
      <div>
        <button type="button" className="pill px-3 py-1 text-sm" disabled={upgrading || refreshing} onClick={() => void upgrade()}>{upgrading ? "Updating lesson…" : "Update with AI"}</button>
        {upgradeFailed && <p role="alert">The lesson couldn't be updated. Try again later.</p>}
      </div>
    );
    if (!checked && !data.completed)
      return <Notice>
        <p>This lesson needs updated checks before it can be played.</p>
        {update}
        <Link to="/" className="underline">Home</Link>
      </Notice>;
    const read = (footer: ReactNode) => {
      if (part?.kind === "learn") return <Suspense fallback={fallback}><div className="lq lq-moon flex h-dvh flex-col"><LearnView title={data.title} body={part.body} doc={part.doc} next={footer} /></div></Suspense>;
      if (part?.kind === "watch") return <Suspense fallback={fallback}><WatchView lessonId={data.id} title={data.title} part={part} next={footer} completed={data.completed} /></Suspense>;
      return fallback;
    };
    if (checked) return <Suspense fallback={fallback}><CheckedLesson key={data.id} kind={data.kind} checks={data.steps} completed={data.completed} refreshing={refreshing} contentAvailable={part !== null} next={next} onFinished={reloadChecked}>{read}</CheckedLesson></Suspense>;
    return read(update ? <div className="flex flex-wrap items-center justify-center gap-3">{next}{update}</div> : next);
  }
  if (data.kind === "practice" && part?.kind === "practice")
    return <Suspense fallback={fallback}><LessonWorkbench key={part.revision} kind="practice" lessonId={data.id} title={data.title} part={part} next={next} media={practiceMedia(data.media)} /></Suspense>;
  if (data.kind === "scrim" && part?.kind === "scrim")
    return <Suspense fallback={fallback}><ScrimLesson lessonId={data.id} title={data.title} part={part} steps={data.steps} media={data.media} next={next} /></Suspense>;
  if (data.kind === "game-practice" && part?.kind === "game-practice")
    return <Suspense fallback={fallback}><div className="flex h-dvh flex-col">{progress}<GamePracticeView lessonId={data.id} versionId={part.versionId} title={data.title} intro={part.intro} doc={part.doc} next={next} onComplete={courseState.reload} /></div></Suspense>;
  if (data.kind === "predict" && data.steps.length > 0)
    return <>{progress}<Suspense fallback={fallback}><Steps lesson={data} next={next} onFinished={courseState.reload} /></Suspense></>;
  return (
    <Notice>
      This lesson isn't ready yet.{" "}
      <button type="button" className="pill px-3 py-1 text-sm" onClick={reload}>Try again</button>{" "}
      <Link to="/" className="underline">Home</Link>
    </Notice>
  );
}
