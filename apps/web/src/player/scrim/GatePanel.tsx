import { useState } from "react";
import { useMachine } from "@xstate/react";
import { TRPCClientError } from "@trpc/client";
import { useApi } from "../../lib/api";
import { trpc } from "../../lib/trpc";
import { PredictPanel, RevealPanel } from "../LivePanels";
import { canHint, canSubmit, stepMachine, type Reveal, type StepPublic } from "../stepMachine";

const rpcMsg = (e: unknown) => (e instanceof TRPCClientError ? e.message : "Something went wrong. Try again.");

const noSkip = () => undefined;

type GateProps = { stepId: string; ordinal: number; total: number; onDone: () => void };

function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="font-medium">
      {message}{" "}
      <button type="button" className="pill ml-1 px-3 py-1 text-sm" onClick={onRetry}>Retry</button>
    </div>
  );
}

function RevealView({ stepId, ordinal, total, state, correct, step, onDone }: GateProps & { state: "revealed" | "skipped"; correct: boolean | null; step: StepPublic }) {
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

function GateRun({ stepId, ordinal, total, step, onDone }: GateProps & { step: StepPublic }) {
  const [snap, send] = useMachine(stepMachine, { input: { lessonSteps: total, idx: ordinal, step } });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
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
        onSubmit={(answer) => run(async () => send({ type: "RESULT", r: await trpc.steps.attempt.mutate({ id: stepId, answer }) }))}
        onHint={() => run(async () => send({ type: "HINT", hint: await trpc.steps.hint.mutate({ id: stepId }) }))}
        onSkip={noSkip}
      />
    );
  return <p role="status" className="font-medium">Loading step…</p>;
}

export default function GatePanel(props: GateProps) {
  const { data, error, reload } = useApi(`gate:${props.stepId}`, () => trpc.steps.get.query({ id: props.stepId }));
  if (error) return <Failure message={rpcMsg(error)} onRetry={reload} />;
  if (!data) return <p role="status" className="font-medium">Loading step…</p>;
  return <GateRun key={props.stepId} {...props} step={data} />;
}
