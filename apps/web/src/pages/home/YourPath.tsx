import { Link } from "@tanstack/react-router";
import { Code2 } from "lucide-react";
import type { HomeData } from "../../lib/api";
import { pct } from "./pct";

function courseLanguage(title: string, tagline: string) {
  if (/\btypescript\b/i.test(title) || (/\btyped\b/i.test(title) && /\btypescript\b/i.test(tagline))) return "TS";
  if (/\bjavascript\b/i.test(title)) return "JS";
}

export default function YourPath({ p }: { p: HomeData["paths"][number] }) {
  const nowIndex = p.courses.findIndex((course) => !(course.lessonsTotal > 0 && course.lessonsDone >= course.lessonsTotal));
  return (
    <article className="lq-dashboard-path">
      <h3><Link to="/paths/$slug" params={{ slug: p.slug }}>{p.title}</Link></h3>
      <p className="lq-tagline">{p.building ? "Setting up your path" : p.tagline}</p>
      {p.courses.length > 0 && (
        <ol className="lq-dashboard-courses" aria-label={`${p.title} courses`}>
          {p.courses.map((course, index) => {
            const done = course.lessonsTotal > 0 && course.lessonsDone >= course.lessonsTotal;
            const current = !p.building && index === nowIndex;
            const upcoming = !p.building && nowIndex >= 0 && index === nowIndex + 1 && course.lessonsDone === 0;
            const language = courseLanguage(course.title, p.tagline);
            return (
              <li key={course.slug}>
                <Link to="/paths/$slug" params={{ slug: p.slug }} hash={course.slug} className="lq-dashboard-course" aria-current={current ? "step" : undefined} data-upcoming={upcoming || undefined}>
                  <div className="lq-dashboard-course-head">
                    <span className="lq-dashboard-course-icon" data-language={language} aria-hidden="true">{language ?? <Code2 size={16} />}</span>
                    <div>
                      <span className="lq-dashboard-course-label">Course {index + 1}{done ? " · Complete" : current ? " · Current" : ""}</span>
                      <h4>{course.title}</h4>
                    </div>
                    {upcoming && <span className="lq-dashboard-course-next">Up next</span>}
                  </div>
                  <div className={`lq-meter sm${done ? " f-mint" : ""}`} role="progressbar" aria-label={`${course.title} progress`} aria-valuemin={0} aria-valuemax={course.lessonsTotal} aria-valuenow={course.lessonsDone}>
                    <span style={{ width: `${pct(course.lessonsDone, course.lessonsTotal)}%` }} />
                  </div>
                  <span className="lq-dashboard-meta">{course.lessonsDone} / {course.lessonsTotal} lessons</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
