import { Link } from "@tanstack/react-router";
import type { HomeData } from "../../lib/api";
import { Arrow } from "./art";
import { pct } from "./pct";

export function ResumeLink({ resume }: { resume: NonNullable<HomeData["resume"]> }) {
  return <Link to="/play" search={{ lesson: resume.lessonSlug, course: resume.courseSlug }} className="lq-pill lq-resume-link">Resume {resume.title}<Arrow /></Link>;
}

export default function Continue({ c, resume }: { c: NonNullable<HomeData["continue"]>; resume: HomeData["resume"] }) {
  const { lesson, recommendation, snippet } = c;
  const action = recommendation?.reasonCode === "PREREQUISITES" ? "course" : recommendation?.action ?? "lesson";
  const showResume = resume && (action === "course" || action === "review" || resume.lessonSlug !== lesson.slug);
  return (
    <section className={`lq-card lq-hero lq-continue-photo lq-rise d2${snippet ? "" : " lq-hero-solo"}`} aria-labelledby="hero-h">
      <div className="lq-hero-main">
        <p className="lq-hero-eyebrow">{c.path.title} · Course {c.course.index + 1} of {c.course.count}</p>
        <h2 id="hero-h" className="lq-hero-title">{c.course.title}</h2>
        <p className="lq-hero-lesson">{recommendation?.action !== "assess" && `Level ${lesson.level} · `}{lesson.title}</p>
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
          {action === "course"
            ? <Link to="/courses/$slug" params={{ slug: c.course.slug }} className="lq-btn lq-btn-ink lq-btn-xl">Course<Arrow /></Link>
            : action === "review"
            ? <Link to="/review/$slug" params={{ slug: c.course.slug }} className="lq-btn lq-btn-ink lq-btn-xl">Review<Arrow /></Link>
            : <Link to="/play" search={{ lesson: lesson.slug, course: c.course.slug }} className="lq-btn lq-btn-ink lq-btn-xl">Continue<Arrow /></Link>}
          {showResume && <ResumeLink resume={resume} />}
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
