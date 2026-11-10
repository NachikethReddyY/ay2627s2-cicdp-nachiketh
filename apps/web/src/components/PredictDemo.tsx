import { useEffect, useRef, useState } from "react";
import { Check, Sprout } from "lucide-react";

const OPTIONS = ["+=", "=", "-=", "*="];
const ANSWER = 0;
const TABS = ["cart.js", "cart.test.js"];
// the line with the blank gets the active-line band
const ACTIVE_LINE = 4;
const TYPE_MS = 260;

/** Eases a number toward `target` so the mastery readout counts up. */
function useCountUp(target: number) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min((now - t0) / 700, 1);
      const next = Math.round(start + (target - start) * (1 - (1 - k) ** 3));
      setV(next);
      from.current = next;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

const Kw = ({ children }: { children: string }) => <span className="lp-kw">{children}</span>;

/** One numbered line of the sample editor. The number is decoration; the code is the text. */
const Line = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <div className={n === ACTIVE_LINE ? "lp-ln is-on" : "lp-ln"}>
    <span className="lp-n" aria-hidden>{n}</span>
    <span className="lp-src">{children}</span>
  </div>
);

type Status = "todo" | "now" | "done";

/**
 * The landing hero: a workbench that plays one static step through the whole loop. The editor and
 * the choices sit on the left; the rail on the right tracks predict, hint, reveal and adapt as you
 * go. It is drawn as the practice editor's window (see /test/editor). Styled by pages/landing.css (`.lp`).
 */
export default function PredictDemo() {
  const [wrong, setWrong] = useState<number[]>([]);
  const [hints, setHints] = useState(0);
  const [done, setDone] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [lastWrong, setLastWrong] = useState<number | null>(null);
  // how much of the change the replay has typed into the blank
  const [typed, setTyped] = useState(0);

  const answer = OPTIONS[ANSWER];
  const replayed = done && typed >= answer.length;

  // the reveal: once you have guessed right, the editor types the change in
  useEffect(() => {
    if (!done || typed >= answer.length) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setTimeout(() => setTyped(reduce ? answer.length : typed + 1), reduce ? 0 : TYPE_MS);
    return () => clearTimeout(id);
  }, [done, typed, answer.length]);

  // rung 1 crosses out one wrong option, rung 2 shows a worked example
  const crossed = hints >= 1 ? [2] : [];
  const assisted = wrong.length > 0 || hints > 0;
  // BKT numbers from the plan: 0.20 -> 0.58 (clean), 0.20 -> 0.23 (hint-assisted counts as a miss)
  const earned = assisted ? 23 : 58;
  const mastery = replayed ? earned : 20;
  const shownMastery = useCountUp(mastery);

  const mood = done ? "cheer" : lastWrong !== null && hints === 0 ? "oops" : hints > 0 ? "think" : "wave";
  const moodAnim = done ? "is-hop" : mood === "wave" ? "is-sway" : "is-pop";

  const pick = (i: number) => {
    if (done || crossed.includes(i) || wrong.includes(i)) return;
    if (i === ANSWER) return setDone(true);
    setWrong([...wrong, i]);
    setLastWrong(i);
    setShakeKey((k) => k + 1);
  };

  const reset = () => {
    setWrong([]);
    setHints(0);
    setDone(false);
    setLastWrong(null);
    setTyped(0);
  };

  const rail: { name: string; status: Status; body: string; state: string }[] = [
    {
      name: "Predict",
      status: done ? "done" : "now",
      body: "Say what the change does before you see it.",
      state: done ? "Guessed" : wrong.length > 0 ? "Try again" : "Your move",
    },
    {
      name: "Hint",
      status: hints === 0 ? "todo" : done ? "done" : "now",
      body: "Stuck? Take one rung at a time. Never the answer.",
      state: `${hints} of 2 used`,
    },
    {
      name: "Reveal",
      status: !done ? "todo" : replayed ? "done" : "now",
      body: "The editor replays the change for you.",
      state: !done ? "After your guess" : replayed ? "Replayed" : "Replaying",
    },
    {
      name: "Adapt",
      status: replayed ? "now" : "todo",
      body: !replayed
        ? "What you got right decides your next step."
        : assisted
          ? "Right, with help. A small step: hints do not earn mastery."
          : "Right on the first try. A big step.",
      state: replayed ? `Loops 20% to ${earned}%` : "After the reveal",
    },
  ];

  const state = (i: number) => (done && i === ANSWER ? " (correct)" : wrong.includes(i) ? " (not it)" : crossed.includes(i) ? " (crossed out by the hint)" : "");

  return (
    <div id="try" className="lp-win" role="group" aria-label="Try one step">
      <div className="lp-titlebar">
        <div className="lp-lights" aria-hidden>
          <i /><i /><i />
        </div>
        <div className="lp-tabs">
          {TABS.map((t, i) => (
            <span key={t} className={`lp-tab ${i === 0 ? "is-on" : ""}`}>
              <span className="lp-badge" aria-hidden>JS</span>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="lp-bench-body">
        <div className="lp-bench-main">
          <div className="lp-editor" role="group" aria-label={`${TABS[0]}, line ${ACTIVE_LINE} is highlighted`}>
            <Line n={1}><Kw>function</Kw>{" "}<span className="lp-fnn">total</span>{"(items) {"}</Line>
            <Line n={2}>{"  "}<Kw>let</Kw>{" sum = "}<span className="lp-num">0</span>{";"}</Line>
            <Line n={3}>{"  "}<Kw>for</Kw>{" ("}<Kw>const</Kw>{" i "}<Kw>of</Kw>{" items) {"}</Line>
            <Line n={4}>
              {"    sum "}
              <span className={`lp-slot ${done ? "is-typing" : ""} ${replayed ? "is-done" : ""}`}>
                {done ? answer.slice(0, typed) : "____"}
              </span>
              {" i.price;"}
            </Line>
            <Line n={5}>{"  }"}</Line>
            <Line n={6}>{"  "}<Kw>return</Kw>{" sum;"}</Line>
            <Line n={7}>{"}"}</Line>
          </div>

          <div className="lp-predict">
            <p className="lp-question">What does this commit change on the highlighted line?</p>

            <div className="lp-opts" role="group" aria-label="Choices">
              {OPTIONS.map((o, i) => {
                const out = crossed.includes(i);
                const bad = wrong.includes(i);
                const good = done && i === ANSWER;
                return (
                  <button
                    key={o + (i === lastWrong ? shakeKey : "")}
                    onClick={() => pick(i)}
                    disabled={out || bad || done}
                    className={`lp-opt ${good ? "is-good pop" : bad ? "is-bad shake" : out ? "is-out" : ""}`}
                  >
                    {o}
                    <span className="lp-vh">{state(i)}</span>
                  </button>
                );
              })}
            </div>

            <div className="lp-demo-foot">
              <div aria-live="polite" className="lp-feedback">
                {hints >= 1 && !done && (
                  <p key={`hint-${hints}`} className="lp-note lp-note-hint slide-in">
                    <b>Hint 1:</b> one wrong choice is crossed out.
                    {hints >= 2 && <> <b>Hint 2:</b> Worked example: <code>count -= 1</code> takes one off <code>count</code>, once per loop.</>}
                  </p>
                )}
                {wrong.length > 0 && !done && <p key={`miss-${shakeKey}`} className="lp-miss slide-in">Not quite. Take a hint, or try again.</p>}
                {done && (
                  <p className="lp-note lp-note-done slide-in">
                    <b>Right.</b> <code>+=</code> adds each price to the running total. Reveal unlocked: the replay types it out
                    for you. <span className="lp-aside">(Reconstructed replay)</span>
                  </p>
                )}
              </div>
              <div className="lp-demo-action">
                {done ? (
                  <button type="button" onClick={reset} className="lp-btn lp-btn-quiet lp-btn-sm">Try again</button>
                ) : (
                  <button type="button" onClick={() => setHints(Math.min(hints + 1, 2))} disabled={hints >= 2} className="lp-btn lp-btn-quiet lp-btn-sm">
                    Hint
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="lp-rail" aria-label="Where you are in this step">
          <ol>
            {rail.map((r) => (
              <li key={r.name} className={`lp-rail-row is-${r.status}`} aria-current={r.status === "now" ? "step" : undefined}>
                <span className="lp-rail-mark" aria-hidden>{r.status === "done" && <Check size={11} strokeWidth={3.5} />}</span>
                <div>
                  <p className="lp-rail-head">
                    <span className="lp-rail-name">{r.name}</span>
                    <span className="lp-rail-state">{r.state}</span>
                  </p>
                  <p className="lp-rail-body">{r.body}</p>
                </div>
              </li>
            ))}
          </ol>
          {/* the sprout reacts to what you do: one sway or pop per change, keyed so it replays */}
          <span key={mood + (done ? "d" : "")} className={`lp-railmark ${moodAnim}`} aria-hidden><Sprout size={40} strokeWidth={2} /></span>
        </aside>
      </div>

      <div className="lp-statusbar">
        <span className="lp-stat">
          Loops mastery <b>{shownMastery}%</b>
          <span className="lp-mini" aria-hidden><i style={{ width: `${mastery}%` }} /></span>
        </span>
        <span>Hint {hints}/2 · {done ? "Revealed" : "Predict first"}</span>
      </div>
    </div>
  );
}
