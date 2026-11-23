import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMachine } from "@xstate/react";
import { buildTimeline } from "@learnquest/player-core";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { PredictPanel, RevealPanel } from "../LivePanels";
import { canHint, canSubmit, stepMachine, type Reveal } from "../stepMachine";
import PredictWorkbench from "./PredictWorkbench";
import PredictNarration from "./PredictNarration";
import type { Lesson } from "./types";
import { useLessonAnalytics } from "./lessonAnalytics";

const rpcMsg = (e: unknown) => (e instanceof TRPCClientError ? e.message : "Something went wrong. Try again.");

export default function Steps({ lesson, progress, next, onFinished }: { lesson: Lesson; progress?: ReactNode; next?: ReactNode; onFinished?: () => void }) {
  const n = lesson.steps.length;
  const start = Math.max(0, lesson.steps.findIndex((s) => s.state !== "revealed" && s.state !== "skipped"));
  const [snap, send] = useMachine(stepMachine, { input: { lessonSteps: n, idx: start } });
  const analytics = useLessonAnalytics();
  const { idx, step, reveal, hints } = snap.context;
  const stepId = lesson.steps[idx]?.id;
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [retries, setRetries] = useState(0);
  const state = snap.value as string;

  useEffect(() => {
    if (state === "finished") onFinished?.();
  }, [state, onFinished]);

  useEffect(() => {
    if (state !== "browse" || !stepId) return;
    let live = true;
    trpc.steps.get.query({ id: stepId }).then((s) => live && send({ type: "LOADED", step: s }), (e) => live && setFailed(rpcMsg(e)));
    return () => { live = false; };
  }, [state, stepId, send, retries]);
  useEffect(() => {
    if ((state !== "revealed" && state !== "skipped") || reveal || !stepId) return;
    let live = true;
    trpc.steps.reveal.query({ id: stepId }).then(
      (r) => live && send({ type: "REVEAL_LOADED", reveal: r as Reveal }),
      (e) => live && setFailed(rpcMsg(e)),
    );
    return () => { live = false; };
  }, [state, reveal, stepId, send, retries]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      if (e instanceof TRPCClientError && e.data?.code === "CONFLICT") send({ type: "CONFLICT", msg: e.message });
      else setFailed(rpcMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const timeline = useMemo(() => {
    const beforeFiles = step?.beforeFiles ?? {};
    try {
      return buildTimeline([{ beforeFiles, hunks: reveal?.hunks ?? [] }]);
    } catch {
      return buildTimeline([{ beforeFiles, hunks: [] }]);
    }
  }, [step, reveal]);

  const answered = state === "revealed" || state === "skipped";
  const narration = answered ? lesson.media.find((m) => m.stepId === stepId && m.kind === "narration")?.url : undefined;

  const id = stepId ?? "";
  let panel: ReactNode;
  if (state === "finished") {
    panel = (
      <div role="status">
        <h3 className="text-2xl font-semibold tracking-tight">Lesson complete</h3>
        {next ?? <a href="/" className="btn mt-4 inline-block">Back home</a>}
      </div>
    );
  } else if (failed) {
    panel = (
      <div role="alert" className="font-medium">
        {failed}{" "}
        <button type="button" className="pill ml-1 px-3 py-1 text-sm" onClick={() => { setFailed(""); setRetries((n) => n + 1); send({ type: "CONFLICT", msg: "" }); }}>Retry</button>
      </div>
    );
  } else if (step && (state === "revealed" || state === "skipped")) {
    panel = <RevealPanel key={id} idx={idx} total={n} state={state} correct={snap.context.lastCorrect} step={step} reveal={reveal} showReplayHint={timeline.duration > 0} last={idx + 1 >= n} onNext={() => send({ type: "NEXT" })} />;
  } else if (step && (state === "predicting" || state === "hinting")) {
    panel = (
      <PredictPanel
        key={id} idx={idx} total={n} step={step} hints={hints} feedback={snap.context.feedback} notice={snap.context.notice} busy={busy}
        canSubmit={canSubmit(snap)} canHint={canHint(snap)}
        onSubmit={(answer) => run(async () => {
          const result = await trpc.steps.attempt.mutate({ id, answer });
          send({ type: "RESULT", r: result });
          analytics.answered(lesson.kind, step.kind, idx + 1, result);
        })}
        onHint={() => run(async () => send({ type: "HINT", hint: await trpc.steps.hint.mutate({ id }) }))}
      />
    );
  } else {
    panel = <p role="status" className="font-medium">Loading step…</p>;
  }

  return (
    <PredictWorkbench
      key={id}
      title={lesson.title}
      timeline={timeline}
      task={<>{progress}{panel}</>}
      narration={answered && reveal && <PredictNarration stepId={id} url={narration} text={reveal.narration} />}
      revealed={reveal !== null}
      finished={state === "finished"}
    />
  );
}
