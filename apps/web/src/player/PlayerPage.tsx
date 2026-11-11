import { lazy } from "react";
import { useSearch } from "@tanstack/react-router";
import LiveLesson from "./LiveLesson";
import { Notice } from "./live/Notice";

// The bundled sample is for local previews; production builds drop it.
const FixturePlayer = import.meta.env.DEV ? lazy(() => import("./FixturePlayer")) : null;

export default function PlayerPage() {
  // The route's search, not window.location: a move to the next lesson must re-render this page.
  const { lesson: slug, course } = useSearch({ from: "/play" });
  // key: moving to the next lesson starts a fresh lesson, with no state carried over from the last one.
  if (slug) return <LiveLesson key={slug} slug={slug} course={course} />;
  if (FixturePlayer) return <FixturePlayer />;
  return (
    <Notice>
      Pick a lesson to start. <a href="/" className="underline">Home</a>
    </Notice>
  );
}
