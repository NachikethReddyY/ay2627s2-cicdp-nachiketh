import { Link } from "@tanstack/react-router";
import type { HomeData } from "../../lib/api";
import { Check } from "./art";
import { Flame, Zap } from "lucide-react";
import { pct } from "./pct";

// The streak and today's goal in one panel.
export default function Sidebar({ stats, leaderboard }: { stats: HomeData["stats"]; leaderboard: HomeData["leaderboard"] }) {
  return (
    <aside className="lq-side" aria-label="Your progress">
      <section className="lq-card lq-stat lq-streak lq-rise d2" aria-label="Streak">
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 12, marginTop: 10 }}>
          <Flame size={48} strokeWidth={1.75} className="lq-flame text-[var(--warn)]" aria-hidden="true" />
          <p><span className="lq-score">{stats.streak}</span> <span className="lq-unit">days</span></p>
        </div>
        <ul className="lq-days" aria-label="This week">
          {stats.week.map((d) => {
            const today = d.state === "today";
            const on = d.solved >= 3;
            const label = new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { weekday: "long" });
            return (
              <li key={d.day} className={`lq-day${on ? " on" : ""}${today ? " today" : ""}${d.state === "future" ? " future" : ""}`}>
                <span className="sr">{today ? `${label}, today` : label}: {d.solved} solved</span>
                <span className="lq-dot" aria-hidden="true">{on ? <Check size={18} /> : `${d.solved}/3`}</span>
                <span aria-hidden="true">{label[0]}</span>
              </li>
            );
          })}
        </ul>

        <div className="lq-goal">
          <p style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            <span className="lq-big">{stats.todayXp}</span>
            <span className="lq-big-of"> / {stats.dailyGoalXp}</span>{" "}
            <span className="lq-unit">XP today</span>{" "}
            <Zap size={20} fill="currentColor" className="text-[#7aa2ff]" aria-hidden="true" style={{ marginLeft: "auto" }} />
          </p>
          <div
            className="lq-meter sm f-blue" role="progressbar" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={stats.dailyGoalXp}
            aria-valuenow={stats.todayXp} style={{ marginTop: 12 }}
          >
            <span style={{ width: `${pct(stats.todayXp, stats.dailyGoalXp)}%` }} />
          </div>
        </div>
        <div className="lq-week-total">
          <p className="lq-unit">Weekly XP, last 7 days</p>
          {leaderboard.optedIn ? (
            <>
              <ol className="lq-board">
                {leaderboard.rows.length === 0 && <li className="lq-board-empty">Nobody has joined yet.</li>}
                {leaderboard.rows.map((r) => (
                  <li key={r.rank} className={r.you ? "you" : undefined}>
                    <span className="lq-board-rank">{r.rank}</span>
                    <span className="lq-board-name">{r.name}</span>
                    <span className="lq-board-xp">{r.xp} XP</span>
                  </li>
                ))}
              </ol>
              {leaderboard.rows.some((r) => r.you) ? (
                <p className="lq-board-own">You&apos;re #{leaderboard.rows.find((r) => r.you)?.rank} this week with {leaderboard.xp} XP.</p>
              ) : leaderboard.rank === null && (
                <p className="lq-board-own">You&apos;re not ranked yet. Earn XP this week to get on the board.</p>
              )}
              {leaderboard.rank !== null && leaderboard.rank > leaderboard.rows.length && (
                <ol className="lq-board lq-board-self">
                  <li className="you">
                    <span className="lq-board-rank">{leaderboard.rank}</span>
                    <span className="lq-board-name">You</span>
                    <span className="lq-board-xp">{leaderboard.xp} XP</span>
                  </li>
                </ol>
              )}
            </>
          ) : (
            <>
              <p className="lq-board-own">You have {leaderboard.xp} XP this week.</p>
              <Link to="/account" className="lq-see-all" style={{ alignSelf: "flex-start" }}>Join the leaderboard</Link>
            </>
          )}
        </div>
      </section>
    </aside>
  );
}
