import { lazy } from "react";
import LiveLesson from "./LiveLesson";
import { Notice } from "./live/Notice";

// The bundled sample is for local previews; production builds drop it.
const FixturePlayer = import.meta.env.DEV ? lazy(() => import("./FixturePlayer")) : null;

export default function PlayerPage() {
  const q = new URLSearchParams(location.search);
  const slug = q.get("lesson");
  if (slug) return <LiveLesson slug={slug} course={q.get("course") ?? undefined} />;
  if (FixturePlayer) return <FixturePlayer />;
  return (
    <Notice>
      Pick a lesson to start. <a href="/" className="underline">Home</a>
    </Notice>
  );
}
