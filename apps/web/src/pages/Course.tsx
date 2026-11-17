import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Check, ChevronDown, Lock, Star } from "lucide-react";
import { useApi, type CourseData } from "../lib/api";
import { authClient } from "../lib/auth";
import { isNotFound, trpc } from "../lib/trpc";
import { Spinner } from "../components/Bits";
import { Logo } from "./landing/Logo";
import LessonNode from "./course/LessonNode";
import PathTrack from "./course/PathTrack";
import "./home.css";
import "./course/course.css";

const wave = [0, 1, 0, -1];
const ROW = 112;

function useWide() {
  const q = "(min-width: 640px)";
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setWide(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return wide;
}

export default function Course() {
  const { slug } = useParams({ from: "/courses/$slug" });
  const { data, error } = useApi(`course:${slug}`, () => trpc.courses.get.query({ slug }));
  const { data: session } = authClient.useSession();
  const wide = useWide();
  const [open, setOpen] = useState<string | null>(null);
  const [syl, setSyl] = useState(false);

  let body;
  if (error) {
    body = (
      <div className="chunk course-empty">
        <div>
          <p>{isNotFound(error) ? "We couldn't find that course." : "Couldn't load this course."}</p>
          <Link to="/explore" className="btn course-empty-btn">Explore paths</Link>
        </div>
      </div>
    );
  } else if (!data) {
    body = <Spinner />;
  } else {
    const done = (l: CourseData["lessons"][number]) => l.total > 0 && l.done >= l.total;
    const current = data.lessons.find((l) => !done(l));
    const levels = [...new Set(data.lessons.map((l) => l.level))].sort((a, b) => a - b);
    // progress bar follows the current lesson's level, or the last level once everything is done
    const lvNow = current?.level ?? levels[levels.length - 1];
    const inLv = data.lessons.filter((l) => l.level === lvNow);
    const doneInLv = inLv.filter(done).length;
    const pct = inLv.length ? Math.round((doneInLv / inLv.length) * 100) : 0;
    const amp = wide ? 72 : 40;
    let n = 0;
    body = (
      <div className="course-wrap">
        <section className="chunk course-head">
          <p className="course-eyebrow">
            <span className="course-badge">Course</span>
            <span className="course-eyebrow-n">
              · {data.lessons.length} {data.lessons.length === 1 ? "lesson" : "lessons"}
            </span>
          </p>
          <h1>{data.title}</h1>
          <p className="course-desc">{data.description}</p>
          <p className="course-note">Each part is written when you open it, so no AI is wasted.</p>
          {lvNow !== undefined && (
            <div className="course-prog">
              <p className="course-prog-label">{doneInLv} of {inLv.length} {inLv.length === 1 ? "lesson" : "lessons"} done in Level {lvNow}</p>
              <div className="course-meter" role="progressbar" aria-label={`Level ${lvNow} progress`} aria-valuemin={0} aria-valuemax={inLv.length} aria-valuenow={doneInLv}>
                <span className={pct === 0 ? "zero" : ""} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          <button type="button" aria-expanded={syl} aria-controls="syllabus" onClick={() => setSyl(!syl)} className="course-syl-btn">
            {syl ? "Hide" : "Show"} syllabus <ChevronDown size={16} aria-hidden />
          </button>
          {syl && (
            <ol id="syllabus" className="course-syl">
              {data.lessons.map((l) => {
                const st = done(l) ? "done" : l === current ? "cur" : "locked";
                return (
                  <li key={l.slug} className={st}>
                    <span className="course-syl-mark" aria-hidden="true">
                      {st === "done" ? <Check size={14} strokeWidth={2.5} /> : st === "cur" ? <Star size={13} strokeWidth={2.25} /> : <Lock size={12} strokeWidth={2.25} />}
                    </span>
                    <span className="course-syl-code">L{String(l.level).padStart(2, "0")}</span>
                    <span className="course-syl-title">{l.title}</span>
                    <span className="sr">{st === "done" ? "Complete" : st === "cur" ? "Current lesson" : "Locked"}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <div className="course-path-scroll" role="region" aria-label="Lesson path" tabIndex={0}>
          <div className="course-path">
            {levels.map((lv) => {
              const ls = data.lessons.filter((l) => l.level === lv);
              const xs = ls.map(() => amp * wave[n++ % 4]);
              const lit = ls.filter((l) => done(l) || l === current).length;
              return (
                <section key={lv} aria-labelledby={`lv${lv}`} className="course-level">
                  <div className="course-lv">
                    <span className="course-lv-line" aria-hidden="true" />
                    <h2 id={`lv${lv}`} className="course-lv-pill">
                      Level {lv} · {ls[0].title}
                    </h2>
                    <span className="course-lv-line" aria-hidden="true" />
                  </div>
                  <div className="course-level-path">
                    <PathTrack xs={xs} lit={lit} row={ROW} />
                    <ol className="course-nodes">
                      {ls.map((l, i) => {
                        const state = done(l) ? "done" : l === current ? "cur" : "locked";
                        const cta = state === "done" ? "Review" : l.done > 0 ? "Continue" : "Start";
                        return <LessonNode key={l.slug} l={l} slug={slug} state={state} x={xs[i]} cta={cta} open={open === l.slug} setOpen={setOpen} />;
                      })}
                    </ol>
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        {current && (
          <div className="course-cta">
            <div className="course-cta-text">
              <p className="course-cta-meta">Level {current.level} · Lesson {data.lessons.filter((l) => l.level === current.level).indexOf(current) + 1}</p>
              <p className="course-cta-title">{current.title}</p>
            </div>
            <Link to="/play" search={{ lesson: current.slug, course: slug }} className="btn course-cta-btn">
              {current.done > 0 ? "Continue" : "Start"}
            </Link>
          </div>
        )}
      </div>
    );
  }

  const initial = session?.user.email?.charAt(0).toUpperCase() ?? "?";
  return (
    <div className="lq lq-moon course">
      <header className="lq-topbar">
        <Link to="/" className="lq-logo">
          <Logo />
        </Link>
        <nav className="lq-topnav" aria-label="Main">
          <Link to="/" className="lq-topnav-link">Home</Link>
          <Link to="/explore" className="lq-topnav-link">Explore</Link>
          <Link to="/account" className="lq-avatar" aria-label="Account settings">{initial}</Link>
        </nav>
      </header>
      <main className="course-main">{body}</main>
    </div>
  );
}
