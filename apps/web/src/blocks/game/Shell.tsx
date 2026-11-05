import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Outcome } from "./model.ts";

export const btn = "min-h-11 min-w-11 rounded-full border-2 border-ink bg-white px-4 font-extrabold disabled:opacity-40";

type Props = {
  title: string; goalText: string; alt: string; hints: string[];
  lives?: number; maxLives?: number;
  outcome: Outcome;
  /** Announced in the aria-live region: every move, bump, pick, win and lose. No timers anywhere (WCAG 2.2.1). */
  live: string;
  onRetry: () => void;
  onComplete?: () => void | Promise<unknown>;
  children: ReactNode;
};

/** What every game shares: title, goal, alt, hints, lives, win/lose banner, Retry and the live region. */
export default function Shell({ title, goalText, alt, hints, lives, maxLives, outcome, live, onRetry, onComplete, children }: Props) {
  const [shown, setShown] = useState(0);
  const completed = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // A failed save re-arms the guard so the learner can retry; the win itself still stands.
  const save = useCallback(() => {
    if (completed.current || !onComplete) return;
    completed.current = true;
    setSaveFailed(false);
    Promise.resolve()
      .then(onComplete)
      .catch(() => {
        completed.current = false;
        setSaveFailed(true);
      });
  }, [onComplete]);
  useEffect(() => {
    if (outcome === "win") save();
  }, [outcome, save]);
  const over = outcome === "win" || outcome === "lose";
  return (
    <section aria-label={title} className="flex min-w-0 max-w-full flex-col gap-3 rounded-2xl border-2 border-ink bg-white p-3">
      <h3 className="break-words text-lg font-extrabold">{title}</h3>
      <p className="break-words text-sm font-bold">{goalText}</p>
      <p className="break-words text-sm">{alt}</p>
      {lives !== undefined && <p className="text-sm font-extrabold">Lives: {lives} of {maxLives}</p>}
      {children}
      <p role="status" aria-live="polite" className="min-h-6 break-words text-sm font-bold">{live}</p>
      {over && (
        <div role="group" aria-label={outcome === "win" ? "You win" : "Game over"} className={`rounded-2xl border-2 border-ink p-3 ${outcome === "win" ? "bg-mint" : "bg-pink"}`}>
          <p className="text-lg font-extrabold">{outcome === "win" ? "You win!" : "Game over"}</p>
          {outcome === "win" && saveFailed && (
            <p role="alert" className="mt-1 text-sm font-bold">
              Couldn't save your progress.{" "}
              <button type="button" className={btn} onClick={save}>Retry saving</button>
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={onRetry}>Retry</button>
        {hints.length > 0 && (
          <button type="button" className={btn} disabled={shown >= hints.length} onClick={() => setShown(shown + 1)}>
            Show hint ({shown} of {hints.length})
          </button>
        )}
      </div>
      <ol aria-live="polite" aria-label="Hints" className="list-decimal pl-5 text-sm">
        {hints.slice(0, shown).map((h, i) => <li key={i} className="break-words">{h}</li>)}
      </ol>
    </section>
  );
}
