import { Link } from "@tanstack/react-router";
import type { HomeData } from "../../lib/api";
import { pct } from "./pct";

export default function YourPath({ p }: { p: HomeData["paths"][number] }) {
  const nowIndex = p.courses.findIndex((course) => !(course.lessonsTotal > 0 && course.lessonsDone >= course.lessonsTotal));
  return (
    <article className="lq-dashboard-path">
      <h3>{p.title}</h3>
      <p className="lq-tagline">{p.tagline}</p>
      {p.courses.length > 0 && (
        <ol className="lq-dashboard-courses" aria-label={`${p.title} courses`}>
          {p.courses.map((course, index) => {
            const done = course.lessonsTotal > 0 && course.lessonsDone >= course.lessonsTotal;
            const current = index === nowIndex;
            return (
              <li key={course.slug}>
                <Link to="/courses/$slug" params={{ slug: course.slug }} className="lq-dashboard-course" aria-current={current ? "step" : undefined}>
                  <span className="lq-dashboard-course-label">Course {index + 1}{done ? " · Complete" : current ? " · Current" : ""}</span>
                  <h4>{course.title}</h4>
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
