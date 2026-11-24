import { Link } from "@tanstack/react-router";
import { Braces, Clock3 } from "lucide-react";
import type { MouseEvent } from "react";
import type { HomeData } from "../../lib/api";
import { isInAppLinkClick, useContinueAnalytics, type ContinueAction } from "../../player/live/lessonAnalytics";
import { Arrow } from "./art";
import { pct } from "./pct";

export function ResumeLink({ resume }: { resume: NonNullable<HomeData["resume"]> }) {
  return <Link to="/lessons" search={{ lesson: resume.lessonSlug, course: resume.courseSlug }} state={{ lessonEntrySource: "home_resume" }} className="lq-pill lq-resume-link">Resume {resume.title}<Arrow /></Link>;
}

export default function Continue({ c, resume }: { c: NonNullable<HomeData["continue"]>; resume: HomeData["resume"] }) {
  const { lesson, recommendation, snippet } = c;
  const captureContinue = useContinueAnalytics("home_continue");
  const track = (action: ContinueAction) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (isInAppLinkClick(event)) captureContinue(action);
  };
  const action = recommendation?.reasonCode === "PREREQUISITES" ? "course" : recommendation?.action ?? "lesson";
  const reviewing = action === "review" || recommendation?.reasonCode === "REVIEW";
  const showResume = resume && (action === "course" || action === "review" || resume.lessonSlug !== lesson.slug);
  return (
    <section className="lq-card lq-hero lq-dashboard-hero" aria-labelledby="hero-h">
      <div className="lq-hero-main">
        <p className="lq-dashboard-kicker">Up next</p>
        <p className="lq-hero-eyebrow">{c.path.title} · Course {c.course.index + 1} of {c.course.count}</p>
        <h2 id="hero-h" className="lq-hero-title">{lesson.title}</h2>
        <p className="lq-hero-lesson">{c.course.title}{recommendation?.action !== "assess" && ` · Level ${lesson.level}`}</p>
        {recommendation && <p className="lq-hero-reason">{recommendation.reason}</p>}
        {reviewing ? <span className="lq-dashboard-review"><Clock3 size={14} aria-hidden="true" /> {action === "review" ? "Review due" : "Review recommended"}</span> : <div className="lq-hero-meter">
          <div
            className="lq-meter sm" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={c.lesson.total}
            aria-valuenow={c.lesson.done}
          >
            <span style={{ width: `${pct(c.lesson.done, c.lesson.total)}%` }} />
          </div>
          <span className="lq-hero-count">{c.lesson.done} / {c.lesson.total}</span>
        </div>}
        <div className="lq-hero-cta">
          {action === "course"
            ? <Link to="/courses/$slug" params={{ slug: c.course.slug }} className="lq-btn lq-btn-ink" onClick={track("course")}>Course<Arrow /></Link>
            : action === "review"
            ? <Link to="/review/$slug" params={{ slug: c.course.slug }} className="lq-btn lq-btn-ink" onClick={track("review")}>Review<Arrow /></Link>
            : <Link to="/lessons" search={{ lesson: lesson.slug, course: c.course.slug }} state={{ lessonEntrySource: "home_continue" }} className="lq-btn lq-btn-ink" onClick={track(action === "assess" ? "assess" : "lesson")}>{reviewing ? "Review" : "Continue"}<Arrow /></Link>}
          {showResume && <ResumeLink resume={resume} />}
        </div>
      </div>
      {snippet ? (
        <div className="lq-code" aria-hidden="true">
          <span className="lq-code-label">Predict</span>
          {snippet.map((line, i) => <div key={i} className="lq-dashboard-code-line">{line || " "}</div>)}
          <div className="q">&gt; ? ? ?</div>
        </div>
      ) : <div className="lq-dashboard-code-mark" aria-hidden="true"><Braces size={36} strokeWidth={1.25} /></div>}
    </section>
  );
}
