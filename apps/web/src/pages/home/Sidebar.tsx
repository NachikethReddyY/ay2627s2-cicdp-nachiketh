import type { HomeData } from "../../lib/api";
import { Bolt, Check, Flame } from "./art";
import { pct } from "./pct";

const LEAGUE_XP = 500;

export default function Sidebar({ stats }: { stats: HomeData["stats"] }) {
  return (
    <aside className="lq-side" aria-label="Your progress">
      <section className="lq-card lq-stat lq-bg-sun lq-tr lq-rise d2" aria-labelledby="streak-h">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 id="streak-h">Streak</h2>
          <span className="lq-sticker lq-bg-surface lq-r">{stats.streak > 0 ? "ON FIRE" : "DAY 1 AWAITS"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 10 }}>
          <Flame w={64} h={80} cls="lq-flame" />
          <p><span className="lq-score">{stats.streak}</span> <span style={{ font: "400 24px var(--font-display)" }}>days</span></p>
        </div>
        <ul className="lq-days" aria-label="This week">
          {stats.week.map((d, i) => {
            const today = i === stats.week.length - 1;
            const on = d.solved >= 3;
            const label = new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { weekday: "long" });
            return (
              <li key={d.day} className={`lq-day${on ? " on" : ""}${today ? " today" : ""}`}>
                <span className="sr">{today ? `${label}, today` : label}: {d.solved} solved</span>
                <span className="lq-dot" aria-hidden="true">{on ? <Check size={18} /> : `${d.solved}/3`}</span>
                <span aria-hidden="true">{label[0]}</span>
              </li>
            );
          })}
        </ul>
        <p className="lq-rule"><Flame w={16} h={20} stroke={3} />Solve 3 problems to keep your streak.</p>
      </section>

      <section className="lq-card lq-stat lq-bg-surface lq-tl lq-rise d3" aria-labelledby="goal-h">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 id="goal-h">Daily goal</h2>
          <Bolt w={26} h={30} />
        </div>
        <p style={{ marginTop: 12 }}>
          <span style={{ font: "400 52px/1 var(--font-display)" }}>{stats.todayXp}</span>
          <span style={{ font: "400 28px var(--font-display)" }}> / {stats.dailyGoalXp}</span>{" "}
          <span style={{ font: "700 16px var(--font-body)" }}>XP today</span>
        </p>
        <div
          className="lq-meter lg f-mint" role="progressbar" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={stats.dailyGoalXp}
          aria-valuenow={stats.todayXp} style={{ marginTop: 14 }}
        >
          <span style={{ width: `${pct(stats.todayXp, stats.dailyGoalXp)}%` }} />
        </div>
      </section>

      <section className="lq-card lq-stat lq-league lq-tr lq-rise d4" aria-labelledby="league-h">
        <span className="lq-sticker lq-bg-surface" style={{ position: "absolute", top: -14, right: 18 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth={2.5} /><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth={2.5} /></svg>
          LOCKED
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg className="lq-trophy-lock" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M18 8h28v14a14 14 0 0 1-28 0z" fill="#B9A6FF" stroke="#15121F" strokeWidth={3} strokeLinejoin="round" />
            <path d="M18 14H9a10 10 0 0 0 10 12M46 14h9a10 10 0 0 1-10 12" fill="none" stroke="#15121F" strokeWidth={3} />
            <path d="M28 36h8v10h-8zM20 46h24v9H20z" fill="#B9A6FF" stroke="#15121F" strokeWidth={3} strokeLinejoin="round" />
            <text x="32" y="27" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize={16} fill="#15121F">?</text>
          </svg>
          <div>
            <h2 id="league-h">Leagues</h2>
            <p style={{ font: "700 15px var(--font-body)", marginTop: 4 }}>Unlocks at {LEAGUE_XP} XP</p>
          </div>
        </div>
        <div
          className="lq-meter f-lilac" role="progressbar" aria-label="Leagues unlock progress" aria-valuemin={0}
          aria-valuemax={LEAGUE_XP} aria-valuenow={Math.min(stats.xp, LEAGUE_XP)} style={{ marginTop: 16 }}
        >
          <span style={{ width: `${pct(Math.min(stats.xp, LEAGUE_XP), LEAGUE_XP)}%` }} />
        </div>
        <p style={{ display: "flex", justifyContent: "space-between", marginTop: 8, font: "700 14px var(--font-body)" }}>
          <span>{stats.xp} / {LEAGUE_XP} XP</span>
          <span>{Math.max(LEAGUE_XP - stats.xp, 0)} XP to go</span>
        </p>
      </section>
    </aside>
  );
}
