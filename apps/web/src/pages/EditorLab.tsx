import { Suspense, lazy } from "react";
import { useSearch } from "@tanstack/react-router";
import { isNotFound, trpc } from "../lib/trpc";
import { useApi } from "../lib/api";
import { NextLink } from "../player/live/CourseNav";
import { Notice } from "../player/live/Notice";
import { labTarget } from "./labTarget";

const LessonWorkbench = lazy(() => import("../player/live/LessonWorkbench"));

function Lab({ slug, course }: { slug: string; course?: string }) {
  const { data, error, reload } = useApi(`lab:${slug}`, () => trpc.lessons.get.query({ id: slug }));
  if (error)
    return (
      <Notice>
        {isNotFound(error) ? "We couldn't find that lesson." : "We couldn't load this lesson."}{" "}
        {!isNotFound(error) && <button type="button" className="pill px-3 py-1 text-sm" onClick={reload}>Try again</button>}{" "}
        <a href="/" className="underline">Home</a>
      </Notice>
    );
  if (!data) return <Notice><p>Loading the lab…</p></Notice>;
  const target = labTarget(data);
  if ("error" in target)
    return (
      <Notice>
        {target.error} <a href="/" className="underline">Home</a>
      </Notice>
    );
  const back = course ? <NextLink href={`/courses/${course}`}>Back to course</NextLink> : <NextLink href="/">Back home</NextLink>;
  return (
    <Suspense fallback={<Notice><p>Loading the lab…</p></Notice>}>
      <LessonWorkbench key={target.part.revision} lessonId={data.id} title={data.title} part={target.part} next={<div className="flex justify-center">{back}</div>} />
    </Suspense>
  );
}

export default function EditorLab() {
  const { lesson, course } = useSearch({ from: "/editor" });
  if (lesson) return <Lab key={lesson} slug={lesson} course={course} />;
  return (
    <Notice>
      Pick a lesson to open its lab. <a href="/" className="underline">Home</a>
    </Notice>
  );
}
