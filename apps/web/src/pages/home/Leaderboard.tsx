import type { HomeData } from "../../lib/api";

export default function Leaderboard({ leaderboard }: { leaderboard: HomeData["leaderboard"] }) {
  const { rank, rows } = leaderboard;
  const xp = rank === null ? leaderboard.xp : rows[rank - 1]?.xp ?? leaderboard.xp;
  return (
    <section className="lq-card lq-dashboard-leaderboard" aria-labelledby="leaderboard-h">
      <h2 id="leaderboard-h">Weekly XP leaderboard</h2>
      <p className="lq-dashboard-meta">Last 7 days</p>
      {leaderboard.rows.length > 0 && (
        <ol className="lq-board" role="list">
          {rows.map(({ handle, xp: rowXp }, index) => {
            const position = index + 1;
            return (
              <li key={handle} className={position === rank ? "you" : undefined}>
                <span className="lq-board-rank" data-rank={position}>{position}</span>
                <span className="lq-board-avatar" aria-hidden="true">{handle.charAt(0).toUpperCase()}</span>
                <span className="lq-board-name">{handle}</span>
                <span className="lq-board-xp">{rowXp} XP</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="lq-board-own">
        {rank === null ? "Earn XP this week to get on the board." : `You're #${rank} this week with ${xp} XP.`}
      </p>
    </section>
  );
}
