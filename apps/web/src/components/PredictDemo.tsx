import { useEffect, useRef, useState } from "react";

const OPTIONS = ["+=", "=", "-=", "*="];
const ANSWER = 0;
const COLORS = ["bg-[#5cc8f0]", "bg-[#f06ca8]", "bg-[#1890e4]", "bg-[#e4c46c]", "bg-[#6cd4a4]"];
// 14 pieces fanned out from the blank
const PIECES = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  const d = 90 + (i % 3) * 30;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d - 20, rot: (i % 2 ? 1 : -1) * (120 + i * 25), c: COLORS[i % COLORS.length] };
});

/** Eases a number toward `target` so the mastery readout counts up with its bar. */
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

export default function PredictDemo() {
  const [wrong, setWrong] = useState<number[]>([]);
  const [hints, setHints] = useState(0);
  const [done, setDone] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [lastWrong, setLastWrong] = useState<number | null>(null);

  // rung 1 crosses out one wrong option, rung 2 shows a worked example
  const crossed = hints >= 1 ? [2] : [];
  const assisted = wrong.length > 0 || hints > 0;
  // BKT numbers from the plan: 0.20 -> 0.58 (clean), 0.20 -> 0.23 (hint-assisted counts as a miss)
  const mastery = !done ? 20 : assisted ? 23 : 58;
  const shownMastery = useCountUp(mastery);

  const mood = done ? "cheer" : lastWrong !== null && hints === 0 ? "oops" : hints > 0 ? "think" : "wave";
  const moodAnim = done ? "hop" : mood === "wave" ? "wiggle" : "pop";

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
  };

  return (
    <div className="relative pt-[6.4rem]">
      {/* Pip sits on the card edge and reacts to what you do */}
      <img
        key={mood + (done ? "d" : "")}
        src={`/img/pip-${mood}.png`}
        alt=""
        className={`absolute left-4 top-0 z-10 h-28 w-28 object-contain ${moodAnim}`}
      />

      <div className="lp-glass p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="lp-track h-2 flex-1">
            <div className="lp-fill transition-all duration-700 ease-out" style={{ width: done ? "100%" : "40%", "--tone-a": "#6cd4a4", "--tone-b": "#bfeed8" } as React.CSSProperties} />
          </div>
          <span className="font-mono text-xs text-[var(--lp-muted)]">cart.ts</span>
        </div>

        <p className="font-medium">What does this commit change on the highlighted line?</p>
        <div className="relative">
          <pre className="my-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/35 p-4 font-mono text-[12px] leading-6 text-white/90 sm:text-[13px]">
{`function total(items) {
  let sum = 0;
  for (const i of items) {
    sum `}
            <span key={String(done)} className={`inline-block rounded-md px-2 text-[#202020] ${done ? "pop bg-[#6cd4a4]" : "ring bg-[#5cc8f0]"}`}>
              {done ? OPTIONS[ANSWER] : "____"}
            </span>
{` i.price;
  }
  return sum;
}`}
          </pre>
          {done && (
            <div aria-hidden className="pointer-events-none absolute left-[7.5rem] top-[5.2rem]">
              {PIECES.map((p, i) => (
                <span
                  key={i}
                  className={`confetti ${p.c}`}
                  style={{ "--x": `${p.x}px`, "--y": `${p.y}px`, "--rot": `${p.rot}deg`, animationDelay: `${i * 12}ms` } as React.CSSProperties}
                />
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3" role="group" aria-label="Choices">
          {OPTIONS.map((o, i) => {
            const out = crossed.includes(i);
            const bad = wrong.includes(i);
            const good = done && i === ANSWER;
            return (
              <button
                key={o + (i === lastWrong ? shakeKey : "")}
                onClick={() => pick(i)}
                disabled={out || bad || done}
                style={{ animationDelay: `${i * 70}ms` }}
                className={`lp-opt rise rounded-2xl border border-white/15 px-4 py-3 font-mono font-medium ${
                  good ? "pop bg-[#6cd4a4] text-[#202020]" : bad ? "shake bg-[#e47860]/25" : out ? "bg-white/5 text-white/30 line-through" : "bg-white/10 hover:bg-white/20"
                }`}
              >
                {o}
              </button>
            );
          })}
        </div>

        <div aria-live="polite" className="mt-4 min-h-[3.5rem] text-sm">
          {hints >= 1 && !done && (
            <p key={hints} className="slide-in mb-1 rounded-xl border border-[#e4c46c]/30 bg-[#e4c46c]/12 px-3 py-2">
              <b>Hint 1:</b> one wrong choice is crossed out.
              {hints >= 2 && <> <b>Hint 2:</b> <code className="font-mono">count += 1</code> adds to <code className="font-mono">count</code>, once per loop.</>}
            </p>
          )}
          {wrong.length > 0 && !done && <p key={shakeKey} className="slide-in font-medium text-white/70">Not quite. Take a hint, or try again.</p>}
          {done && (
            <p className="slide-in rounded-xl border border-[#6cd4a4]/30 bg-[#6cd4a4]/12 px-3 py-2">
              <b>Right.</b> <code className="font-mono">+=</code> adds each price to the running total. Reveal unlocked: the replay
              types it out for you. <span className="opacity-60">(Reconstructed replay)</span>
            </p>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          {done ? (
            <button onClick={reset} className="text-sm font-medium underline decoration-2 underline-offset-4">Try again</button>
          ) : (
            <button
              onClick={() => setHints(Math.min(hints + 1, 2))}
              disabled={hints >= 2}
              className="lp-btn lp-btn--ghost lp-btn--small disabled:opacity-40"
            >
              Hint ({hints}/2)
            </button>
          )}
          <div className="flex items-center gap-2 text-xs font-medium">
            Loops mastery
            <div className="lp-track h-2 w-24">
              <div className="lp-fill transition-all duration-700 ease-out" style={{ width: `${mastery}%`, "--tone-a": "#1890e4", "--tone-b": "#5cc8f0" } as React.CSSProperties} />
            </div>
            <span className="w-9 tabular-nums">{shownMastery}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
