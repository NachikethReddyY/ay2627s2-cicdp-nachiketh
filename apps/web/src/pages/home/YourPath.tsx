import { Link } from "@tanstack/react-router";
import type { HomeData } from "../../lib/api";
import { Check } from "./art";
import { pct } from "./pct";

export default function YourPath({ p, index }: { p: HomeData["paths"][number]; index: number }) {
  const nowIndex = p.courses.findIndex((c) => !(c.lessonsTotal > 0 && c.lessonsDone >= c.lessonsTotal));
  return (
    <article className="lq-card lq-path lq-path-photo">
      <div className="lq-path-head">
        <span className={`lq-path-badge ${index % 2 ? "lq-bg-lilac" : "lq-bg-blue"}`} aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <h3>{p.title}</h3>
          <p className="lq-tagline">{p.tagline}</p>
        </div>
      </div>
      <div className="lq-track" role="region" aria-label={`${p.title} courses`} tabIndex={0}>
        <ol className="lq-track-inner">
          {p.courses.map((c, i) => {
            const done = c.lessonsTotal > 0 && c.lessonsDone >= c.lessonsTotal;
            const now = i === nowIndex;
            const state = done ? "done" : now ? "now" : "";
            const fill = done ? "f-mint" : "f-blue";
            const w = pct(c.lessonsDone, c.lessonsTotal);
            return (
              <li key={c.slug}>
                <Link to="/courses/$slug" params={{ slug: c.slug }} className={`lq-tile lq-lift ${state}`}>
                  {done && (
                    <>
                      <span className="lq-stampbox lq-stamp" aria-hidden="true"><Check size={22} /></span>
                      <svg className="lq-sparkle lq-spark" style={{ top: -10, left: 14 }} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1c1 6 5 10 11 11-6 1-10 5-11 11-1-6-5-10-11-11 6-1 10-5 11-11z" /></svg>
                    </>
                  )}
                  <span className="num">COURSE {i + 1}{now && <span className="lq-current"> · CURRENT</span>}</span>
                  <h4>{c.title}</h4>
                  {done && <span className="sr">Completed. </span>}
                  <div className={`lq-meter sm ${fill}`} role="progressbar" aria-label={`${c.title} progress`} aria-valuemin={0} aria-valuemax={c.lessonsTotal} aria-valuenow={c.lessonsDone}>
                    <span style={{ width: `${w}%` }} />
                  </div>
                  <span className="xy">{c.lessonsDone} / {c.lessonsTotal}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </article>
  );
}
