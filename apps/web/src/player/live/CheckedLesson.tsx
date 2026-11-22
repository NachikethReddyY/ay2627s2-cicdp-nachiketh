import { useState, type ReactNode } from "react";
import GatePanel from "../scrim/GatePanel";
import { offersNext, stageFor, type ClosingPhase } from "./readFlow";

type Check = { id: string; state: "predicting" | "hinting" | "revealed" | "skipped" };

type Props = {
  checks: readonly Check[];
  completed: boolean;
  refreshing: boolean;
  next: ReactNode;
  onFinished: () => void;
  children: (footer: ReactNode) => ReactNode;
};

type PageProps = { check: Check; ordinal: number; total: number; onDone: () => void; onAttempt?: () => void };

function CheckPage({ check, ordinal, total, onDone, onAttempt }: PageProps) {
  return (
    <main className="lq lq-moon grid min-h-dvh place-items-center p-6 text-[color:var(--tx)]">
      <div className="chunk w-full max-w-2xl p-5">
        <GatePanel key={check.id} skippable={false} showCode showAnswer={false} stepId={check.id} ordinal={ordinal} total={total} onDone={onDone} onAttempt={onAttempt} />
      </div>
    </main>
  );
}

export default function CheckedLesson({ checks, completed, refreshing, next, onFinished, children }: Props) {
  const [phase, setPhase] = useState<ClosingPhase>("off");
  const opening = checks[0];
  const closing = checks[checks.length - 1];
  const stage = stageFor(checks, completed, phase, refreshing);
  if (stage === "opening") return <CheckPage check={opening} ordinal={0} total={2} onDone={onFinished} />;
  if (stage === "closing")
    return <CheckPage check={closing} ordinal={1} total={2} onAttempt={onFinished} onDone={() => { setPhase("leaving"); onFinished(); }} />;
  const footer = offersNext(checks, completed) ? (
    next
  ) : (
    <button type="button" className="btn" onClick={() => setPhase("on")}>
      Check what you learned
    </button>
  );
  return <>{children(footer)}</>;
}
