import { useEffect, useRef, useState } from "react";
import type { Hint, Reveal, StepPublic } from "./stepMachine";
import { FOCUS } from "./ui";

type Answer = { kind: "mcq"; choice: number } | { kind: "cloze"; text: string };

const Head = ({ idx, total, title }: { idx: number; total: number; title: string }) => (
  <>
    <p className="text-sm font-extrabold text-ink/75">Step {idx + 1} of {total}</p>
    <h3 className="font-display text-xl font-black">{title}</h3>
  </>
);

type PredictProps = {
  idx: number;
  total: number;
  step: StepPublic;
  hints: Hint[];
  feedback: string | null;
  notice: string | null;
  busy: boolean;
  canSubmit: boolean;
  canHint: boolean;
  canSkip: boolean;
  onSubmit: (a: Answer) => void;
  onHint: () => void;
  onSkip: () => void;
};

export function PredictPanel(p: PredictProps) {
  const { step } = p;
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const struck = new Set(p.hints.flatMap((h) => (h.eliminate !== undefined ? [h.eliminate] : [])));
  const ready = step.kind === "mcq" ? choice !== null && !struck.has(choice) : text.trim().length > 0;
  const submit = () => {
    if (!p.canSubmit || !ready || p.busy) return;
    p.onSubmit(step.kind === "mcq" ? { kind: "mcq", choice: choice! } : { kind: "cloze", text: text.trim() });
  };
  const btn = `pill min-h-9 bg-white px-4 text-sm disabled:opacity-50 ${FOCUS}`;
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Head idx={p.idx} total={p.total} title={step.title} />
      <fieldset className="mt-3">
        <legend className="font-semibold">{step.prompt}</legend>
        {step.kind === "mcq" ? (
          <div className="mt-3 flex flex-col gap-2">
            {step.options?.map((o, i) => (
              <label key={i} className={`flex cursor-pointer items-start gap-2 rounded-xl border-[3px] border-ink px-3 py-2 text-sm font-bold has-[:checked]:bg-sun has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${struck.has(i) ? "line-through opacity-50" : "bg-paper"}`}>
                <input type="radio" name="opt" className="mt-1" disabled={struck.has(i)} checked={choice === i} onChange={() => setChoice(i)} />
                <span>{o}{struck.has(i) && <span className="sr-only"> (ruled out by a hint)</span>}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="mt-3">
            <label htmlFor="cloze" className="text-sm font-extrabold">Your answer</label>
            <input id="cloze" value={text} maxLength={200} autoComplete="off" spellCheck={false} onChange={(e) => setText(e.target.value)}
              className={`mt-1 block w-full rounded-xl border-[3px] border-ink bg-white px-3 py-2 font-mono text-sm ${FOCUS}`} />
          </div>
        )}
      </fieldset>

      {p.hints.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm font-semibold">
          {p.hints.map((h) => <li key={h.rung}><span className="font-extrabold">Hint {h.rung}:</span> {h.text}</li>)}
        </ol>
      )}
      <div aria-live="polite" className="mt-3 min-h-5 text-sm font-extrabold">
        {p.notice || (p.feedback && `${p.feedback}${p.canSubmit ? " Try again." : p.canHint ? " Take a hint to try again." : ""}`)}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={!p.canSubmit || !ready || p.busy} className={`btn !px-5 !py-1.5 text-sm disabled:opacity-50 ${FOCUS}`}>Check</button>
        <button type="button" disabled={!p.canHint || p.busy} onClick={p.onHint} className={btn}>Hint</button>
        <button type="button" disabled={!p.canSkip || p.busy} onClick={p.onSkip} className={btn}>Skip</button>
      </div>
    </form>
  );
}

type RevealProps = {
  idx: number;
  total: number;
  state: "revealed" | "skipped";
  correct: boolean | null;
  step: StepPublic;
  reveal: Reveal | null;
  last: boolean;
  onNext: () => void;
};

export function RevealPanel({ idx, total, state, correct, step, reveal, last, onNext }: RevealProps) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => h.current?.focus(), []);
  const heading = state === "skipped" ? "Skipped — here's the answer" : correct ? "Correct!" : "Here's the answer";
  const answer = reveal && (reveal.answer.type === "mcq" ? step.options?.[reveal.answer.index] : reveal.answer.text);
  return (
    <div>
      <Head idx={idx} total={total} title={step.title} />
      <h4 ref={h} tabIndex={-1} className="mt-3 font-display text-lg font-black outline-none">{heading}</h4>
      {!reveal ? (
        <p role="status" className="mt-2 font-semibold">Loading answer…</p>
      ) : (
        <>
          <p className="mt-2 text-sm font-semibold">Answer: <code className="font-mono font-bold">{answer}</code></p>
          <p className="mt-2 font-semibold">{reveal.explanations.workedExample}</p>
          {reveal.narration && reveal.narration !== reveal.explanations.workedExample && (
            <div className="mt-2">
              <p className="text-xs font-extrabold uppercase tracking-wide text-ink/70">Narration</p>
              <p className="text-sm font-semibold">{reveal.narration}</p>
            </div>
          )}
          <p className="mt-2 text-sm font-semibold"><span className="font-extrabold">Try it: </span>{reveal.explanations.practice}</p>
          <p className="mt-2 text-xs font-bold text-ink/70">Watch the change in the player, then move on.</p>
          <button type="button" onClick={onNext} className={`btn mt-4 !px-5 !py-1.5 text-sm ${FOCUS}`}>{last ? "Finish lesson" : "Next step"}</button>
        </>
      )}
    </div>
  );
}
