import { useState, type ReactNode } from "react";
import GatePanel from "../scrim/GatePanel";
import { advance, offersNext } from "./readFlow";

type Check = { id: string; state: "predicting" | "hinting" | "revealed" | "skipped" };

type Props = {
  checks: readonly Check[];
  completed: boolean;
  next: ReactNode;
  onFinished: () => void;
  children: (footer: ReactNode) => ReactNode;
};

function CheckPage({ check, ordinal, total, onDone }: { check: Check; ordinal: number; total: number; onDone: () => void }) {
  return (
    <main className="lq lq-moon grid min-h-dvh place-items-center p-6 text-[color:var(--tx)]">
      <div className="chunk w-full max-w-2xl p-5">
        <GatePanel key={check.id} skippable={false} showCode stepId={check.id} ordinal={ordinal} total={total} onDone={onDone} />
      </div>
    </main>
  );
}

export default function CheckedLesson({ checks, completed, next, onFinished, children }: Props) {
  const [reviewing, setReviewing] = useState(false);
  const opening = checks[0];
  const closing = checks[checks.length - 1];
  const served = advance(checks, completed);
  const stage = served === "reading" && reviewing ? "closing" : served;
  if (stage === "opening") return <CheckPage check={opening} ordinal={0} total={2} onDone={onFinished} />;
  if (stage === "closing")
    return <CheckPage check={closing} ordinal={1} total={2} onDone={() => { setReviewing(false); onFinished(); }} />;
  const footer = offersNext(checks, completed) ? (
    next
  ) : (
    <button type="button" className="btn" onClick={() => setReviewing(true)}>
      Check what you learned
    </button>
  );
  return <>{children(footer)}</>;
}
