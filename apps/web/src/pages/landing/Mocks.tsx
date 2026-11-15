import type { ReactNode } from "react";
import { Check, CircleHelp, Lock } from "lucide-react";
import { Code } from "./Code";

// Product art for the feature rows. Each row has its own composition on purpose: a framed card with an
// action, an editor window, a stack of cards, a chart and a roadmap. Everything is static and decorative;
// the row's heading, paragraph and checklist carry the meaning. Numbers are illustrative, never learner data.

/** Row 1 only: a card, a short connector line, then the action pill with its key hint. */
function ActionCard({ children, action, keyHint }: { children: ReactNode; action: string; keyHint: string }) {
  return (
    <div className="lp-mock">
      <div className="lp-mcard">{children}</div>
      <span className="lp-conn" />
      <span className="lp-pill">{action}<kbd>{keyHint}</kbd></span>
    </div>
  );
}

export function GuessMock() {
  return (
    <ActionCard action="Lock in answer" keyHint="↵">
      <div className="lp-mhead">
        <span className="lp-mic"><CircleHelp size={16} strokeWidth={1.75} /></span>
        <b>Update the total</b>
        <span className="lp-mstat is-blue">Your turn</span>
      </div>
      <p className="lp-msub"><span>cart.js</span><span>line 2</span><span>step 3 of 6</span></p>
      <div className="lp-mbox lp-mcodebox">
        <Code file="cart.js" lines={["const price = item.price * item.qty;", "cart.total ____ price;", "return cart;"]} mark={2} />
      </div>
      <p className="lp-mq">What should line 2 do to the total?</p>
      <p className="lp-chips"><span className="is-on">+=</span><span>=</span><span>-=</span></p>
    </ActionCard>
  );
}

type DiffRow = [kind: "ctx" | "add" | "del", text: string];
const DIFF: DiffRow[] = [
  ["ctx", "function addItem(cart, item) {"],
  ["ctx", "  cart.items.push(item);"],
  ["del", "  cart.total = item.price;"],
  ["add", "  const price = item.price * item.qty;"],
  ["add", "  cart.total += price;"],
  ["ctx", "  return cart;"],
];
const STEPS = ["Start", "Store", "Price", "Total", "Return", "Check"];

/** Row 2: an editor window with a diff, and the six steps of the replay underneath. */
export function ReplayMock() {
  return (
    <div className="lp-win">
      <div className="lp-wbar">
        <span className="lp-dots"><i /><i /><i /></span>
        <span className="lp-tabs"><em className="is-on">cart.js</em><em>cart.test.js</em></span>
      </div>
      <div className="lp-diff">
        {DIFF.map(([kind, text], i) => (
          <p key={i} className={`is-${kind}`}>
            <span className="lp-n">{i + 1}</span>
            <span className="lp-sign">{kind === "add" ? "+" : kind === "del" ? "-" : ""}</span>
            <code>{text}</code>
          </p>
        ))}
      </div>
      <ol className="lp-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < 3 ? "is-done" : i === 3 ? "is-now" : undefined}><i />{s}</li>
        ))}
      </ol>
      <p className="lp-wcap">Step 4 of 6. Update the total.</p>
    </div>
  );
}

/** Row 3: hint cards stacked one behind the other, then the help chat declining to write the answer. */
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

/** Row 4: one concept as a big number and a trend, with the others beside it. */
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

/** Row 5: you ask for any topic and get a path built around it. No fixed curriculum. */
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
