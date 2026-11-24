import { ArrowRight } from "lucide-react";
import type { HomeData } from "../../lib/api";
import { pct } from "./pct";

export default function Mastery({ items, onPractice }: { items: HomeData["mastery"]; onPractice: (skill: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="mastery-h" className="lq-card lq-dashboard-mastery">
      <div className="lq-sec-head">
        <h2 id="mastery-h">What you know</h2>
      </div>
      <ul className="lq-mastery-list">
        {items.map((m) => {
          const value = pct(m.pKnown, 1);
          const level = value < 40 ? "practice" : value >= 80 ? "mastered" : "developing";
          return (
            <li key={m.name} data-mastery={level}>
              <div className="lq-mastery-row">
                <code>{m.name}</code>
                <span className="lq-unit">{value}%</span>
              </div>
              <div className="lq-meter sm" role="progressbar" aria-label={`${m.name} mastery`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
                <span style={{ width: `${value}%` }} />
              </div>
              {level === "practice" && <button type="button" className="lq-mastery-practice" aria-label={`Practice ${m.name}`} onClick={() => onPractice(m.name)}>Practice <ArrowRight size={14} aria-hidden="true" /></button>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
