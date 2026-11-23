import { Link } from "@tanstack/react-router";
import type { HomeData } from "../../lib/api";
import { Arrow } from "./art";
import { pct } from "./pct";

export default function Continue({ c }: { c: NonNullable<HomeData["continue"]> }) {
  const { lesson, recommendation, snippet } = c;
  const label = recommendation?.reasonCode === "REVIEW" ? "Review" : "Continue";
  return (
    <section className={`lq-card lq-hero lq-continue-photo lq-rise d2${snippet ? "" : " lq-hero-solo"}`} aria-labelledby="hero-h">
      <div className="lq-hero-main">
        <p className="lq-hero-eyebrow">{c.path.title} · Course {c.course.index + 1} of {c.course.count}</p>
        <h2 id="hero-h" className="lq-hero-title">{c.course.title}</h2>
        <p className="lq-hero-lesson">Level {lesson.level} · {lesson.title}</p>
        {recommendation && <p className="lq-hero-reason">{recommendation.reason}</p>}
        <div className="lq-hero-meter">
          <div
            className="lq-meter lg f-blue" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={c.lesson.total}
            aria-valuenow={c.lesson.done}
          >
            <span style={{ width: `${pct(c.lesson.done, c.lesson.total)}%` }} />
          </div>
          <span className="lq-hero-count">{c.lesson.done} / {c.lesson.total}</span>
        </div>
        <div className="lq-hero-cta">
          <Link to="/play" search={{ lesson: lesson.slug, course: c.course.slug }} className="lq-btn lq-btn-ink lq-btn-xl">{label}<Arrow /></Link>
        </div>
      </div>
      {snippet && (
        <div className="lq-code" aria-hidden="true">
          <span className="lq-code-label">Predict</span>
          {snippet.map((line, i) => <div key={i} style={{ whiteSpace: "pre" }}>{line || " "}</div>)}
          <div className="q">&gt; ? ? ?</div>
        </div>
      )}
    </section>
  );
}
