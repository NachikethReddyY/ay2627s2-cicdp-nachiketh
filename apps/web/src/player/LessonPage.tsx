import { Link, useLocation, useSearch } from "@tanstack/react-router";
import LiveLesson from "./LiveLesson";
import { Notice } from "./live/Notice";

export default function LessonPage() {
  const { lesson: slug, course, path } = useSearch({ from: "/lessons" });
  const entrySource = useLocation({ select: (location) => location.state.lessonEntrySource });
  if (slug) return <LiveLesson key={slug} slug={slug} course={course} path={path} entrySource={entrySource} />;
  return (
    <Notice>
      Pick a lesson to start. <Link to="/" className="underline">Home</Link>
    </Notice>
  );
}
