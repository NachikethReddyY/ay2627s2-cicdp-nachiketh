import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { authClient } from "../../lib/auth";
import { studioApi } from "./studioApi";
import { readStudioRun, writeStudioRun } from "./studioRun";
import type { Clip, Plan, Script, SegmentTranscript, StudioRun, TimedEdit } from "./studioModel";
import "../home.css";

const DEFAULT_TOPIC = "Python data structures";
const DEFAULT_SOURCE = "https://docs.python.org/3/tutorial/datastructures.html";

type Stage = "sample" | "plan" | "script" | "audio" | "transcribe" | "edits";

export default function Studio() {
  const { data: session } = authClient.useSession();
  const accountId = session?.user.id;
  return accountId ? <StudioForAccount key={accountId} accountId={accountId} /> : null;
}

function StudioForAccount({ accountId }: { accountId: string }) {
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_SOURCE);
  const [run, setRun] = useState(() => readStudioRun(accountId));
  const [busy, setBusy] = useState<Stage | null>(null);
  const [failed, setFailed] = useState<{ stage: Stage; message: string } | null>(null);

  function keep(next: StudioRun) {
    writeStudioRun(accountId, next);
    setRun(next);
  }

  async function runStage(stage: Stage, work: () => Promise<StudioRun>) {
    setBusy(stage);
    setFailed(null);
    try {
      keep(await work());
    } catch (e) {
      setFailed({ stage, message: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  const runPlan = () =>
    runStage("plan", async () => ({ plan: (await studioApi.plan(topic, sourceUrl)).plan }));

  const runScript = () =>
    runStage("script", async () => {
      if (!run.plan) throw new Error("Run the plan first.");
      return { plan: run.plan, script: (await studioApi.script(run.plan)).script };
    });

  const runAudio = () =>
    runStage("audio", async () => {
      if (!run.script) throw new Error("Run the script first.");
      return { plan: run.plan, script: run.script, clips: (await studioApi.audio(run.script.segments)).clips };
    });

  const runTranscribe = () =>
    runStage("transcribe", async () => {
      if (!run.clips) throw new Error("Run the audio stage first.");
      const transcripts: SegmentTranscript[] = [];
      for (const clip of run.clips) {
        const { transcript } = await studioApi.transcribe(clip);
        transcripts.push({ index: clip.index, ...transcript });
      }
      return { plan: run.plan, script: run.script, clips: run.clips, transcripts };
    });

  const runEdits = () =>
    runStage("edits", async () => {
      if (!run.plan || !run.script || !run.transcripts) throw new Error("Run speech to text first.");
      return { ...run, edits: (await studioApi.edits(run.plan, run.script.segments, run.transcripts)).edits };
    });

  const loadSample = () =>
    runStage("sample", async () => (await import("./fixtures/sample-run.json")).default);

  const errorFor = (stage: Stage) => (failed?.stage === stage ? failed.message : null);

  return (
    <div className="lq lq-moon min-h-screen">
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Make a lesson from a source</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="pill px-4 py-2" disabled={busy !== null} onClick={loadSample}>
              {busy === "sample" ? "Loading…" : "Load sample run"}
            </button>
          </div>
          {errorFor("sample") && <p role="alert" className="font-medium">{errorFor("sample")}</p>}
        </header>

        <section className="flex flex-col gap-3 rounded-2xl border p-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Topic</span>
            <input className="rounded-lg border px-3 py-2" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Source (docs.python.org, https)</span>
            <input className="rounded-lg border px-3 py-2" value={sourceUrl} maxLength={500} onChange={(e) => setSourceUrl(e.target.value)} />
          </label>
        </section>

        <StageCard
          n={1}
          title="Plan"
          detail="Read the source and plan the sections."
          action={<RunButton busy={busy === "plan"} disabled={busy !== null} onRun={runPlan} />}
          error={errorFor("plan")}
        >
          {run.plan && <PlanView plan={run.plan} />}
        </StageCard>

        <StageCard
          n={2}
          title="Script"
          detail="Write the narration, with a prediction question where the lesson pauses."
          action={<RunButton busy={busy === "script"} disabled={busy !== null || !run.plan} onRun={runScript} />}
          error={errorFor("script")}
        >
          {run.script && <ScriptView script={run.script} />}
        </StageCard>

        <StageCard
          n={3}
          title="Audio"
          detail="Speak each segment and generate WAV audio."
          action={<RunButton busy={busy === "audio"} disabled={busy !== null || !run.script} onRun={runAudio} />}
          error={errorFor("audio")}
        >
          {run.clips && <ClipsView clips={run.clips} />}
        </StageCard>

        <StageCard
          n={4}
          title="Speech to text"
          detail="Hear each clip back with word timings, so edits can be keyed to the recorded audio."
          action={<RunButton busy={busy === "transcribe"} disabled={busy !== null || !run.clips} onRun={runTranscribe} />}
          error={errorFor("transcribe")}
        >
          {run.transcripts && <TranscriptsView transcripts={run.transcripts} />}
        </StageCard>

        <StageCard
          n={5}
          title="Code edits at timestamps"
          detail="Write the on-screen code as edits, each cued to words in the narration and timed from stage 4."
          action={<RunButton busy={busy === "edits"} disabled={busy !== null || !run.transcripts} onRun={runEdits} />}
          error={errorFor("edits")}
        >
          {run.edits && <EditsView edits={run.edits} />}
        </StageCard>

        <StageCard n={6} title="Preview" detail="Preview the narration, timed code edits, and prediction pauses.">
          {run.clips && busy ? (
            <p className="opacity-70">Wait for the running stage to finish.</p>
          ) : run.clips ? (
            <Link to="/studio/preview" className="pill inline-block px-4 py-2">Preview draft</Link>
          ) : (
            <p className="opacity-70">Run the audio stage first.</p>
          )}
        </StageCard>
      </main>
    </div>
  );
}

function RunButton({ busy, disabled, onRun }: { busy: boolean; disabled?: boolean; onRun: () => void }) {
  return (
    <button type="button" className="pill px-4 py-2" disabled={busy || disabled} onClick={onRun}>
      {busy ? "Running…" : "Run"}
    </button>
  );
}

function StageCard({
  n,
  title,
  detail,
  action,
  error,
  children,
}: {
  n: number;
  title: string;
  detail: string;
  action?: ReactNode;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{n}. {title}</h2>
          <p className="text-sm opacity-80">{detail}</p>
        </div>
        {action}
      </div>
      {error && <p role="alert" className="font-medium">{error}</p>}
      {children}
    </section>
  );
}

function PlanView({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{plan.title}</p>
      <p className="opacity-80">{plan.summary}</p>
      <ol className="list-decimal pl-5">
        {plan.sections.map((s) => (
          <li key={s.goal}>
            {s.goal} <span className="opacity-60">({s.concepts.join(", ")})</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ScriptView({ script }: { script: Script }) {
  return (
    <ol className="flex flex-col gap-3 pl-5">
      {script.segments.map((segment, i) => (
        <li key={i} className="list-decimal">
          <p>{segment.text}</p>
          {segment.predict && <p className="mt-1 italic opacity-80">Predict: {segment.predict}</p>}
        </li>
      ))}
    </ol>
  );
}

function TranscriptsView({ transcripts }: { transcripts: SegmentTranscript[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {transcripts.map((transcript) => (
        <li key={transcript.index} className="flex flex-col gap-1">
          <span className="text-sm opacity-70">
            Segment {transcript.index + 1} · {transcript.words.length} words · ends at {(transcript.words.at(-1)?.end ?? 0).toFixed(1)} s
          </span>
          <p>{transcript.text}</p>
        </li>
      ))}
    </ul>
  );
}

function EditsView({ edits }: { edits: TimedEdit[] }) {
  return (
    <ol className="flex flex-col gap-3 pl-5">
      {edits.map((edit, i) => (
        <li key={i} className="list-decimal">
          <span className="text-sm opacity-70">
            Segment {edit.segment + 1} · {edit.at.toFixed(2)} s · “{edit.cue}”{edit.cueHeard ? "" : " · cue not heard, kept at the previous time"}
          </span>
          {edit.predict && <p className="italic opacity-80">Predict: {edit.predict}</p>}
          <pre className="mt-1 overflow-x-auto rounded-lg border p-2 text-sm"><code>{edit.code}</code></pre>
        </li>
      ))}
    </ol>
  );
}

function ClipsView({ clips }: { clips: Clip[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {clips.map((clip) => (
        <li key={clip.index} className="flex flex-col gap-1">
          <span className="text-sm opacity-70">Segment {clip.index + 1}</span>
          <audio controls preload="metadata" src={clip.audio} />
        </li>
      ))}
    </ul>
  );
}
