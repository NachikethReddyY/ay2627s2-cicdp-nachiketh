import { lazy } from "react";
import { useSearch } from "@tanstack/react-router";
import LiveLesson from "./LiveLesson";
import { Notice } from "./live/Notice";

const FixturePlayer = import.meta.env.DEV ? lazy(() => import("./FixturePlayer")) : null;
const StudioLesson = import.meta.env.DEV || import.meta.env.VITE_STUDIO === "true" ? lazy(() => import("../pages/studio/StudioLesson")) : null;

export default function PlayerPage() {
  const { lesson: slug, course, studio } = useSearch({ from: "/play" });
  if (studio && StudioLesson) return <StudioLesson />;
  if (slug) return <LiveLesson key={slug} slug={slug} course={course} />;
  if (FixturePlayer) return <FixturePlayer />;
  return (
    <Notice>
      Pick a lesson to start. <a href="/" className="underline">Home</a>
    </Notice>
  );
}
