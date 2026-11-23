import type { HomeData } from "../../lib/api";
import { pct } from "./pct";

export default function Mastery({ items }: { items: HomeData["mastery"] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="mastery-h" className="lq-card lq-dashboard-mastery">
      <div className="lq-sec-head">
        <h2 id="mastery-h">What you know</h2>
      </div>
      <ul className="lq-mastery-list">
        {items.map((m) => {
          const value = pct(m.pKnown, 1);
          return (
            <li key={m.name}>
              <div className="lq-mastery-row">
                <span>{m.name}</span>
                <span className="lq-unit">{value}%</span>
              </div>
              <div className="lq-meter sm" role="progressbar" aria-label={`${m.name} mastery`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
                <span style={{ width: `${value}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
