import { useState } from "react";
import { useMachine } from "@xstate/react";
import { TRPCClientError } from "@trpc/client";
import { useApi } from "../../lib/api";
import { trpc } from "../../lib/trpc";
import { OutcomePanel, PredictPanel, RevealPanel } from "../LivePanels";
import { canHint, canSubmit, stepMachine, type Reveal, type StepPublic } from "../stepMachine";
import { useLessonAnalytics } from "../live/lessonAnalytics";

const noSkip = () => undefined;

const rpcMsg = (e: unknown) => (e instanceof TRPCClientError ? e.message : "Something went wrong. Try again.");

type GateProps = { lessonKind: "learn" | "watch" | "scrim"; stepId: string; ordinal: number; total: number; onDone: () => void; onAttempt?: () => void; showCode?: boolean; showAnswer?: boolean; finishOnAttempt?: boolean };


function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="font-medium">
      {message}{" "}
      <button type="button" className="pill ml-1 px-3 py-1 text-sm" onClick={onRetry}>Retry</button>
    </div>
  );
}

function RevealView({ stepId, ordinal, total, state, correct, step, onDone }: Pick<GateProps, "stepId" | "ordinal" | "total" | "onDone"> & { state: "revealed" | "skipped"; correct: boolean | null; step: StepPublic }) {
  const { data, error, reload } = useApi(`reveal:${stepId}`, () => trpc.steps.reveal.query({ id: stepId }));
  if (error) return <Failure message={rpcMsg(error)} onRetry={reload} />;
  return (
    <RevealPanel
      key={stepId}
      idx={ordinal}
      total={total}
      state={state}
      correct={correct}
      step={step}
      reveal={(data as Reveal | undefined) ?? null}
      last={false}
      nextLabel="Continue"
      onNext={onDone}
    />
  );
}

function ReadOutcome({ stepId, ordinal, total, correct, step, onDone }: Pick<GateProps, "stepId" | "ordinal" | "total" | "onDone"> & { correct: boolean; step: StepPublic }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      setMessage((await trpc.steps.aiHint.mutate({ id: stepId })).message);
    } catch (e) {
      setError(rpcMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <OutcomePanel idx={ordinal} total={total} correct={correct} step={step} nextLabel="Continue" onNext={onDone} />
    {!correct && <div className="mt-4">
      {!message && <button type="button" className="pill px-4 py-2 text-sm" disabled={busy} onClick={() => void ask()}>{busy ? "Asking Sloppy…" : "Ask Sloppy for a clue"}</button>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm">{error}</p>}
    </div>}
  </>;
}

function GateRun({ lessonKind, stepId, ordinal, total, step, onDone, onAttempt, showCode = false, showAnswer = true, finishOnAttempt = false }: GateProps & { step: StepPublic }) {
  const analytics = useLessonAnalytics();
  const [snap, send] = useMachine(stepMachine, { input: { lessonSteps: total, idx: ordinal, step } });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [answer, setAnswer] = useState<boolean | null>(null);
  const state = snap.value as string;

  const reload = async () => {
    try {
      send({ type: "LOADED", step: await trpc.steps.get.query({ id: stepId }) });
    } catch (e) {
      setFailed(rpcMsg(e));
    }
  };
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      if (e instanceof TRPCClientError && e.data?.code === "CONFLICT") {
        send({ type: "CONFLICT", msg: e.message });
        await reload();
      } else setFailed(rpcMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (failed)
    return <Failure message={failed} onRetry={() => { setFailed(""); if (state === "browse") void reload(); }} />;
  if (finishOnAttempt && answer !== null)
    return <ReadOutcome stepId={stepId} ordinal={ordinal} total={total} correct={answer} step={snap.context.step ?? step} onDone={onDone} />;
  if ((state === "revealed" || state === "skipped") && !showAnswer)
    return <OutcomePanel idx={ordinal} total={total} correct={snap.context.lastCorrect} step={snap.context.step ?? step} nextLabel="Continue" onNext={onDone} />;
  if (state === "revealed" || state === "skipped")
    return <RevealView stepId={stepId} ordinal={ordinal} total={total} state={state} correct={snap.context.lastCorrect} step={snap.context.step ?? step} onDone={onDone} />;
  if (state === "predicting" || state === "hinting")
    return (
      <PredictPanel
        key={stepId}
        idx={ordinal}
        total={total}
        step={snap.context.step ?? step}
        hints={snap.context.hints}
        feedback={snap.context.feedback}
        notice={snap.context.notice}
        busy={busy}
        canSubmit={canSubmit(snap)}
        canHint={canHint(snap)}
        canSkip={false}
        showSkip={false}
        showCode={showCode}
        onSubmit={(prediction) => run(async () => {
          const r = await trpc.steps.attempt.mutate({ id: stepId, answer: prediction });
          send({ type: "RESULT", r });
          if (finishOnAttempt) setAnswer(r.correct);
          onAttempt?.();
          analytics.answered(lessonKind, step.kind, ordinal + 1, r);
        })}
        onHint={() => run(async () => send({ type: "HINT", hint: await trpc.steps.hint.mutate({ id: stepId }) }))}
        onSkip={noSkip}
      />
    );
  return <p role="status" className="font-medium">Loading step…</p>;
}

export function LoadedGatePanel(props: GateProps & { step: StepPublic }) {
  return <GateRun key={props.stepId} {...props} />;
}

export default function GatePanel(props: GateProps) {
  const { data, error, reload } = useApi(`gate:${props.stepId}`, () => trpc.steps.get.query({ id: props.stepId }));
  if (error) return <Failure message={rpcMsg(error)} onRetry={reload} />;
  if (!data) return <p role="status" className="font-medium">Loading step…</p>;
  return <GateRun key={props.stepId} {...props} step={data} />;
}
