import { Flame, Zap } from "lucide-react";
import type { HomeData } from "../../lib/api";
import { Check } from "./art";
import { pct } from "./pct";

export default function Progress({ stats, path }: { stats: HomeData["stats"]; path?: HomeData["paths"][number] }) {
  const pathDone = path?.courses.reduce((sum, course) => sum + course.lessonsDone, 0) ?? 0;
  const pathTotal = path?.courses.reduce((sum, course) => sum + course.lessonsTotal, 0) ?? 0;
  const goalMet = stats.todayXp >= stats.dailyGoalXp;

  return (
    <section className="lq-card lq-dashboard-progress" aria-labelledby="dashboard-progress">
      <h2 id="dashboard-progress">Your progress</h2>
      <dl className="lq-dashboard-stats">
        <div><dt>Total XP</dt><dd><Zap className="lq-stat-xp" size={16} aria-hidden="true" /> {stats.xp}</dd></div>
        <div><dt>Streak</dt><dd><Flame className="lq-stat-streak" size={16} aria-hidden="true" /> {stats.streak} {stats.streak === 1 ? "day" : "days"}</dd></div>
      </dl>
      <ul className="lq-days" aria-label="This week">
        {stats.week.map((day) => {
          const today = day.state === "today";
          const metGoal = day.solved >= 3;
          const label = new Date(`${day.day}T00:00`).toLocaleDateString(undefined, { weekday: "long" });
          return (
            <li key={day.day} className="lq-day" data-today={today || undefined} data-complete={metGoal || undefined}>
              <span className="sr">{today ? `${label}, today` : label}: {day.solved} observed attempts, goal {metGoal ? "met" : "not met"}</span>
              <span className="lq-dashboard-day-ring" aria-hidden="true">
                <svg viewBox="0 0 36 36">
                  <circle cx={18} cy={18} r={15} />
                  {day.solved > 0 && <circle cx={18} cy={18} r={15} pathLength={3} strokeDasharray={`${Math.min(day.solved, 3)} 3`} />}
                </svg>
                {metGoal ? <Check size={15} /> : label[0]}
              </span>
              {metGoal && <span className="lq-dashboard-day-label" aria-hidden="true">{label[0]}</span>}
            </li>
          );
        })}
      </ul>
      <div className="lq-dashboard-progress-line"><span>Daily goal {goalMet && <span className="lq-dashboard-goal">Goal met!</span>}</span><span>{stats.todayXp} / {stats.dailyGoalXp} XP</span></div>
      <div className={`lq-meter sm${goalMet ? " f-mint" : ""}`} role="progressbar" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={stats.dailyGoalXp} aria-valuenow={Math.min(stats.todayXp, stats.dailyGoalXp)}>
        <span style={{ width: `${pct(stats.todayXp, stats.dailyGoalXp)}%` }} />
      </div>
      <div className="lq-dashboard-progress-line"><span>Path progress</span><span>{path ? `${pathDone} / ${pathTotal} lessons` : "No path yet"}</span></div>
    </section>
  );
}
