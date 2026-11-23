import type { HomeData } from "../../lib/api";
import { Check } from "./art";
import { pct } from "./pct";

export default function Progress({ stats, path }: { stats: HomeData["stats"]; path?: HomeData["paths"][number] }) {
  const pathDone = path?.courses.reduce((sum, course) => sum + course.lessonsDone, 0) ?? 0;
  const pathTotal = path?.courses.reduce((sum, course) => sum + course.lessonsTotal, 0) ?? 0;

  return (
    <section className="lq-card lq-dashboard-progress" aria-labelledby="dashboard-progress">
      <h2 id="dashboard-progress">Your progress</h2>
      <dl className="lq-dashboard-stats">
        <div><dt>Total XP</dt><dd>{stats.xp}</dd></div>
        <div><dt>Streak</dt><dd>{stats.streak} {stats.streak === 1 ? "day" : "days"}</dd></div>
      </dl>
      <ul className="lq-days" aria-label="This week">
        {stats.week.map((day) => {
          const today = day.state === "today";
          const metGoal = day.solved >= 3;
          const label = new Date(`${day.day}T00:00`).toLocaleDateString(undefined, { weekday: "long" });
          return (
            <li key={day.day} className={`lq-day${metGoal ? " on" : ""}${today ? " today" : ""}${day.state === "future" ? " future" : ""}`}>
              <span className="sr">{today ? `${label}, today` : label}: {day.solved} observed attempts</span>
              <span className="lq-dot" aria-hidden="true">{metGoal ? <Check size={16} /> : `${day.solved}/3`}</span>
              <span aria-hidden="true">{label[0]}</span>
            </li>
          );
        })}
      </ul>
      <div className="lq-dashboard-progress-line"><span>Daily goal</span><span>{stats.todayXp} / {stats.dailyGoalXp} XP</span></div>
      <div className="lq-meter sm" role="progressbar" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={stats.dailyGoalXp} aria-valuenow={Math.min(stats.todayXp, stats.dailyGoalXp)}>
        <span style={{ width: `${pct(stats.todayXp, stats.dailyGoalXp)}%` }} />
      </div>
      <div className="lq-dashboard-progress-line"><span>Path progress</span><span>{path ? `${pathDone} / ${pathTotal} lessons` : "No path yet"}</span></div>
    </section>
  );
}
