import { Check, Lock } from "lucide-react";

export function HintMock() {
  return (
    <div className="lp-stack">
      <div className="lp-hcards">
        <p className="lp-hcard is-3"><Lock size={14} strokeWidth={2} />Last hint<em>Locked</em></p>
        <p className="lp-hcard is-2"><Check size={14} strokeWidth={2.25} />The line inside the loop replaces total. It should add to it.</p>
        <p className="lp-hcard is-1"><Check size={14} strokeWidth={2.25} />Look at what happens to total on each pass.</p>
      </div>
      <div className="lp-chat">
        <p className="is-you">Just give me the fixed line.</p>
        <p className="is-bot">I will not write it for you, but you are one character away.</p>
      </div>
      <p className="lp-gainchip">Answered after a hint: <b>no mastery credit</b></p>
    </div>
  );
}

const TREND = "0,104 70,98 140,88 210,70 280,50 350,36 420,24";
const OTHERS: [string, number][] = [["Loops", 45], ["Arrays", 31], ["Conditionals", 18], ["Functions", 12]];

export function MasteryMock() {
  return (
    <div className="lp-chart">
      <p className="lp-cname">Strings</p>
      <p className="lp-cbig">58<small>%</small><em>+38 after a clean first try</em></p>
      <svg viewBox="0 0 420 120" className="lp-spark" aria-hidden preserveAspectRatio="none">
        <defs>
          <linearGradient id="lp-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3fc07a" stopOpacity="0.26" />
            <stop offset="1" stopColor="#3fc07a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${TREND} 420,120 0,120`} fill="url(#lp-area)" />
        <polyline points={TREND} fill="none" stroke="#3fc07a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="420" cy="24" r="4" fill="#3fc07a" />
      </svg>
      <ul className="lp-others">
        {OTHERS.map(([n, v]) => (
          <li key={n}><span>{n}</span><b>{v}%</b></li>
        ))}
      </ul>
    </div>
  );
}

const CHIPS = ["Python basics", "React hooks", "SQL joins", "Git"];
const PATH: [string, string][] = [
  ["Keep a value with useState", "Make a component remember a click."],
  ["Run code with useEffect", "Do something after the page updates."],
  ["Share logic with a custom hook", "Reuse the same behaviour in two places."],
];

export function TopicMock() {
  return (
    <div className="lp-topic">
      <p className="lp-plabel">What do you want to learn to code?</p>
      <p className="lp-pinput"><span>React hooks</span><em>Build my path</em></p>
      <p className="lp-pchips">{CHIPS.map((c) => <span key={c}>{c}</span>)}</p>
      <ol className="lp-road">
        {PATH.map(([n, d], i) => (
          <li key={n} className={i === 0 ? "is-now" : undefined}>
            <i />
            <p><b>{n}</b>{d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
