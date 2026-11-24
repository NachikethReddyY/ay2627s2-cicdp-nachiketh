import { useState, type ReactNode } from "react";
import GatePanel from "../scrim/GatePanel";
import { offersNext, stageFor, type ClosingPhase } from "./readFlow";

type Check = { id: string; state: "predicting" | "hinting" | "revealed" | "skipped" };

type Props = {
  kind: "learn" | "watch";
  checks: readonly Check[];
  completed: boolean;
  refreshing: boolean;
  contentAvailable: boolean;
  intro?: (footer: ReactNode) => ReactNode;
  next: ReactNode;
  onFinished: () => void;
  children: (footer: ReactNode) => ReactNode;
};

type PageProps = { kind: Props["kind"]; check: Check; ordinal: number; total: number; onDone: () => void; onAttempt?: () => void; focusOnMount?: boolean };

const focusCheck = (element: HTMLElement | null) => element?.focus();

function CheckPage({ kind, check, ordinal, total, onDone, onAttempt, focusOnMount }: PageProps) {
  return (
    <main ref={focusOnMount ? focusCheck : undefined} tabIndex={focusOnMount ? -1 : undefined} className="lq lq-moon grid min-h-dvh place-items-center p-6 text-[color:var(--tx)]">
      <div className="chunk w-full max-w-2xl p-5">
        <GatePanel key={check.id} lessonKind={kind} showCode showAnswer={false} finishOnAttempt stepId={check.id} ordinal={ordinal} total={total} onDone={onDone} onAttempt={onAttempt} />
      </div>
    </main>
  );
}

export default function CheckedLesson({ kind, checks, completed, refreshing, contentAvailable, intro, next, onFinished, children }: Props) {
  const [phase, setPhase] = useState<ClosingPhase>("off");
  const [startedOpening, setStartedOpening] = useState(false);
  const opening = checks[0];
  const closing = checks[checks.length - 1];
  const stage = stageFor(checks, completed, phase, refreshing, contentAvailable);
  if (stage === "opening") {
    if (intro && !startedOpening && opening.state === "predicting") {
      return <>{intro(<button type="button" className="btn" onClick={() => setStartedOpening(true)}>Start the check</button>)}</>;
    }
    return <CheckPage kind={kind} check={opening} ordinal={0} total={2} onDone={onFinished} focusOnMount={startedOpening} />;
  }
  if (stage === "closing")
    return <CheckPage kind={kind} check={closing} ordinal={1} total={2} onAttempt={onFinished} onDone={() => { setPhase("leaving"); onFinished(); }} />;
  const footer = offersNext(checks, completed) ? (
    next
  ) : (
    <button type="button" className="btn" onClick={() => setPhase("on")}>
      Check what you learned
    </button>
  );
  return <>{children(footer)}</>;
}
