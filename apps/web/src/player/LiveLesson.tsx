import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMachine } from "@xstate/react";
import { buildTimeline } from "@learnquest/player-core";
import { TRPCClientError } from "@trpc/client";
import { trpc, isNotFound, type RouterOutputs } from "../lib/trpc";
import { useApi } from "../lib/api";
import { Player } from "./PlayerPage";
import { PredictPanel, RevealPanel } from "./LivePanels";
import { canHint, canSkip, canSubmit, stepMachine, type Reveal } from "./stepMachine";

type Lesson = RouterOutputs["lessons"]["get"];

function Notice({ pip = "pip-think", children }: { pip?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-lilac/30 p-6">
      <div className="chunk flex max-w-md items-center gap-4 bg-white p-5">
        <img src={`/img/${pip}.png`} alt="" className="float w-20 shrink-0" />
        <div role="status" aria-live="polite" className="font-bold">{children}</div>
      </div>
    </div>
  );
}

export default function LiveLesson({ slug }: { slug: string }) {
  const { data, error, reload } = useApi(`lesson:${slug}`, () => trpc.lessons.get.query({ id: slug }));
  // lessons.get waits while an AI lesson is written; say so once it takes a moment.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(t);
  }, []);

  if (error)
    return (
      <Notice pip="pip-oops">
        {isNotFound(error) ? "We couldn't find that lesson." : "Pip couldn't write this lesson."}{" "}
        {!isNotFound(error) && <button type="button" className="pill bg-white px-3 py-1 text-sm" onClick={reload}>Try again</button>}{" "}
        <a href="/" className="underline">Home</a>
      </Notice>
    );
  if (!data) return <Notice>{slow ? "Pip is writing your next lesson…" : "Loading lesson…"}</Notice>;
  return <Steps lesson={data} />;
}

const rpcMsg = (e: unknown) => (e instanceof TRPCClientError ? e.message : "Something went wrong. Try again.");

function Steps({ lesson }: { lesson: Lesson }) {
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

  const id = stepId ?? "";
  let panel: ReactNode;
  if (state === "finished") {
    panel = (
      <div role="status">
        <img src="/img/pip-cheer.png" alt="" className="float w-20" />
        <h3 className="font-display text-2xl font-black">Lesson complete</h3>
        <a href="/" className="btn mt-4 inline-block">Back home</a>
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
      live={{ idx: Math.min(idx, n - 1), panel, playKey: reveal }}
    />
  );
}
