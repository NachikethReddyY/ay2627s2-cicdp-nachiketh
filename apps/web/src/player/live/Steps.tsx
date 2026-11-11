import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMachine } from "@xstate/react";
import { buildTimeline } from "@learnquest/player-core";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { PredictPanel, RevealPanel } from "../LivePanels";
import { canHint, canSkip, canSubmit, stepMachine, type Reveal } from "../stepMachine";
import { Player } from "./LazyPlayer";
import type { Lesson } from "./types";

const rpcMsg = (e: unknown) => (e instanceof TRPCClientError ? e.message : "Something went wrong. Try again.");

export default function Steps({ lesson, next, onFinished }: { lesson: Lesson; next?: ReactNode; onFinished?: () => void }) {
  const n = lesson.steps.length;
  const start = Math.max(0, lesson.steps.findIndex((s) => s.state !== "revealed" && s.state !== "skipped"));
  const [snap, send] = useMachine(stepMachine, { input: { lessonSteps: n, idx: start } });
  const { idx, step, reveal, hints } = snap.context;
  const stepId = lesson.steps[idx]?.id;
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  // Bumped by Retry so the load effects run again; the machine only re-syncs (CONFLICT) while answering.
  const [retries, setRetries] = useState(0);
  const state = snap.value as string;

  // The server records a predict lesson's completion with its last answer; onFinished lets the course strip refetch it.
  useEffect(() => {
    if (state === "finished") onFinished?.();
  }, [state, onFinished]);

  // Entering a step (or re-syncing after a 409) loads it; revealed or skipped steps then load their answer.
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
      (r) => live && send({ type: "REVEAL_LOADED", reveal: r as Reveal }), // hunks are unknown[] on the wire; the server validated them
      (e) => live && setFailed(rpcMsg(e)),
    );
    return () => { live = false; };
  }, [state, reveal, stepId, send, retries]);

  // Runs one API call; a 409 means our view is stale, so the machine reloads the step.
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
      return buildTimeline([{ beforeFiles, hunks: [] }]); // a bad hunk must not blank the player
    }
  }, [step, reveal]);

  // Narration explains the change, so it plays only once the learner has answered or skipped, never while predicting.
  const answered = state === "revealed" || state === "skipped";
  const narration = answered ? lesson.media.find((m) => m.stepId === stepId && m.kind === "narration")?.url : undefined;

  const narrationText = answered ? reveal?.narration : undefined;

  const id = stepId ?? "";
  let panel: ReactNode;
  if (state === "finished") {
    panel = (
      <div role="status">
        <img src="/img/pip-cheer.png" alt="" className="float w-20" />
        <h3 className="font-display text-2xl font-black">Lesson complete</h3>
        {next ?? <a href="/" className="btn mt-4 inline-block">Back home</a>}
      </div>
    );
  } else if (failed) {
    panel = (
      <div role="alert" className="font-bold">
        {failed}{" "}
        <button type="button" className="pill ml-1 bg-white px-3 py-1 text-sm" onClick={() => { setFailed(""); setRetries((n) => n + 1); send({ type: "CONFLICT", msg: "" }); }}>Retry</button>
      </div>
    );
  } else if (step && (state === "revealed" || state === "skipped")) {
    panel = <RevealPanel key={id} idx={idx} total={n} state={state} correct={snap.context.lastCorrect} step={step} reveal={reveal} last={idx + 1 >= n} onNext={() => send({ type: "NEXT" })} />;
  } else if (step && (state === "predicting" || state === "hinting")) {
    panel = (
      <PredictPanel
        key={id} idx={idx} total={n} step={step} hints={hints} feedback={snap.context.feedback} notice={snap.context.notice} busy={busy}
        canSubmit={canSubmit(snap)} canHint={canHint(snap)} canSkip={canSkip(snap)}
        onSubmit={(answer) => run(async () => send({ type: "RESULT", r: await trpc.steps.attempt.mutate({ id, answer }) }))}
        onHint={() => run(async () => send({ type: "HINT", hint: await trpc.steps.hint.mutate({ id }) }))}
        onSkip={() => run(async () => { await trpc.steps.skip.mutate({ id }); send({ type: "SKIPPED" }); })}
      />
    );
  } else {
    panel = <p role="status" className="font-bold">Loading step…</p>;
  }

  return (
    <Player
      title={lesson.title}
      stepTitles={lesson.steps.map((s) => s.title)}
      timeline={timeline}
      live={{ idx: Math.min(idx, n - 1), finished: state === "finished", panel, playKey: reveal, narration, narrationText }}
    />
  );
}
