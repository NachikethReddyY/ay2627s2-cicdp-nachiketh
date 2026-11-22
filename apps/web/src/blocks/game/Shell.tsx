import { useState, type ReactNode } from "react";
import type { Outcome } from "./model.ts";

export const btn = "pill min-h-11 min-w-11 px-4 text-sm disabled:opacity-40";
export const btnPrimary = "btn min-h-11 min-w-11 px-4 text-sm";
export const tile = "opt";

type Props = {
  title: string; goalText: string; alt: string;
  hintCount: number;
  onHint: (index: number) => Promise<string>;
  lives?: number; maxLives?: number;
  outcome: Outcome;
  live: string;
  onRetry: () => void;
  busy?: boolean;
  children: ReactNode;
};

export default function Shell({ title, goalText, alt, hintCount, onHint, lives, maxLives, outcome, live, onRetry, busy, children }: Props) {
  const [hints, setHints] = useState<string[]>([]);
  const [hintBusy, setHintBusy] = useState(false);
  const [hintFailed, setHintFailed] = useState(false);
  const over = outcome === "win" || outcome === "lose";
  const showHint = async () => {
    if (hintBusy) return;
    setHintBusy(true), setHintFailed(false);
    try {
      const text = await onHint(hints.length);
      setHints((h) => [...h, text]);
    } catch {
      setHintFailed(true);
    } finally {
      setHintBusy(false);
    }
  };
  return (
    <section aria-label={title} className="flex min-w-0 max-w-full flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-3 shadow-[var(--lift-sm)]">
      <h3 className="break-words text-lg font-semibold tracking-tight">{title}</h3>
      <p className="break-words text-sm font-medium">{goalText}</p>
      <p className="break-words text-sm text-[var(--mu)]">{alt}</p>
      {lives !== undefined && <p className="text-sm font-semibold">Attempts left today: {lives} of {maxLives}</p>}
      {children}
      <p role="status" aria-live="polite" className="min-h-6 break-words text-sm font-medium">{live}</p>
      {over && (
        <div role="group" aria-label={outcome === "win" ? "You win" : "Game over"} className={`rounded-xl border p-3 ${outcome === "win" ? "border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_14%,transparent)]" : "border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_14%,transparent)]"}`}>
          <p className="text-lg font-semibold">{outcome === "win" ? "You win!" : "No attempts left today"}</p>
          {outcome === "lose" && <p className="text-sm">Attempts reset at midnight UTC.</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} disabled={busy || outcome === "lose"} onClick={onRetry}>Retry</button>
        {hintCount > 0 && (
          <button type="button" className={btn} disabled={hints.length >= hintCount || hintBusy} onClick={showHint}>
            Show hint ({hints.length} of {hintCount})
          </button>
        )}
      </div>
      {hintFailed && <p role="alert" className="text-sm font-medium text-[var(--bad)]">Couldn't load the hint. Try again.</p>}
      <ol aria-live="polite" aria-label="Hints" className="list-decimal pl-5 text-sm">
        {hints.map((h, i) => <li key={i} className="break-words">{h}</li>)}
      </ol>
    </section>
  );
}
