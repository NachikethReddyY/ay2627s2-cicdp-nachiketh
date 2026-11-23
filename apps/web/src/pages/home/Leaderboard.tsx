import type { HomeData } from "../../lib/api";

export default function Leaderboard({ leaderboard }: { leaderboard: HomeData["leaderboard"] }) {
  return (
    <section className="lq-card lq-dashboard-leaderboard" aria-labelledby="leaderboard-h">
      <h2 id="leaderboard-h">Weekly XP leaderboard</h2>
      <p className="lq-dashboard-meta">Last 7 days</p>
      {leaderboard.rows.length > 0 && (
        <ol className="lq-board">
          {leaderboard.rows.map(({ handle, xp }, index) => {
            const rank = index + 1;
            return (
              <li key={handle} className={rank === leaderboard.rank ? "you" : undefined}>
                <span className="lq-board-rank">{rank}</span>
                <span className="lq-board-name">{handle}</span>
                <span className="lq-board-xp">{xp} XP</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="lq-board-own">
        {leaderboard.rank === null ? "Earn XP this week to get on the board." : `You're #${leaderboard.rank} this week with ${leaderboard.xp} XP.`}
      </p>
    </section>
  );
}
