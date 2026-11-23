import { lazy } from "react";
import { Link, useLocation, useSearch } from "@tanstack/react-router";
import LiveLesson from "./LiveLesson";
import { Notice } from "./live/Notice";

const FixturePlayer = import.meta.env.DEV ? lazy(() => import("./FixturePlayer")) : null;

export default function PlayerPage() {
  const { lesson: slug, course } = useSearch({ from: "/play" });
  const entrySource = useLocation({ select: (location) => location.state.lessonEntrySource });
  if (slug) return <LiveLesson key={slug} slug={slug} course={course} entrySource={entrySource} />;
  if (FixturePlayer) return <FixturePlayer />;
  return (
    <Notice>
      Pick a lesson to start. <Link to="/" className="underline">Home</Link>
    </Notice>
  );
}
