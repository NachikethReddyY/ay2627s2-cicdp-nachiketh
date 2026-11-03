import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMachine } from "@xstate/react";
import { buildTimeline } from "@learnquest/player-core";
import { TRPCClientError } from "@trpc/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { trpc, isNotFound, type RouterOutputs } from "../lib/trpc";
import { useApi } from "../lib/api";
import Editor from "@monaco-editor/react";
import "./monaco";
import { Player } from "./PlayerPage";
import { runJs } from "./runJs";
import { FOCUS } from "./ui";
import { Bar } from "../components/Bits";
import { PredictPanel, RevealPanel } from "./LivePanels";
import { canHint, canSkip, canSubmit, stepMachine, type Reveal } from "./stepMachine";

type Lesson = RouterOutputs["lessons"]["get"];

function Notice({ pip = "pip-think", children }: { pip?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-mint/40 p-6">
      <div className="chunk flex max-w-md items-center gap-4 bg-white p-5">
        <img src={`/img/${pip}.png`} alt="" className="float w-20 shrink-0" />
        <div role="status" aria-live="polite" className="font-bold">{children}</div>
      </div>
    </div>
  );
}

export default function LiveLesson({ slug, course }: { slug: string; course?: string }) {
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
  if (!data)
    return (
      <Notice>
        <p>{slow ? "Pip is writing your next lesson…" : "Loading lesson…"}</p>
        <div className="mt-3 h-3 w-64 max-w-full overflow-hidden rounded-full border-[3px] border-ink bg-white" aria-hidden="true">
          <div className="sketch h-full w-1/3 rounded-full bg-blue" />
        </div>
      </Notice>
    );
  const next = (
    <div className="flex justify-center">{course ? <CourseNext id={data.id} course={course} /> : <NextLink href="/">Back home</NextLink>}</div>
  );
  const { part } = data;
  const progress = course ? <LessonProgress id={data.id} course={course} /> : null;
  if (data.kind === "learn" && part?.kind === "learn")
    return <>{progress}<LearnView title={data.title} body={part.body} next={next} /></>;
  if (data.kind === "watch" && part?.kind === "watch")
    return <>{progress}<WatchView title={data.title} part={part} next={next} /></>;
  if (data.kind === "practice" && part?.kind === "practice")
    return <>{progress}<PracticeView title={data.title} part={part} next={next} /></>;
  return <>{progress}<Steps lesson={data} /></>;
}

// Where this part sits in its course, so the learner knows how many are left.
function LessonProgress({ id, course }: { id: string; course: string }) {
  const { data } = useApi(`course:${course}`, () => trpc.courses.get.query({ slug: course }));
  const i = data?.lessons.findIndex((l) => l.slug === id) ?? -1;
  if (!data || i < 0) return null;
  const total = data.lessons.length;
  return (
    <div className="sticky top-0 z-30 bg-paper/95 px-4 pt-3 pb-2 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <Bar value={i + 1} total={total} label="Course progress" />
      </div>
    </div>
  );
}

type Part = NonNullable<Lesson["part"]>;

// A plain link so the next part loads fresh; opening it is what makes the server write that part.
const NextLink = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} className="btn mt-4 inline-block">{children}</a>;

function CourseNext({ id, course }: { id: string; course: string }) {
  const { data } = useApi(`course:${course}`, () => trpc.courses.get.query({ slug: course }));
  if (!data) return <button type="button" disabled className="btn mt-4 opacity-50">Next</button>;
  const next = data.lessons[data.lessons.findIndex((l) => l.slug === id) + 1];
  return next ? <NextLink href={`/play?lesson=${next.slug}&course=${course}`}>Next</NextLink> : <NextLink href={`/courses/${course}`}>Back to course</NextLink>;
}

function LearnView({ title, body, next }: { title: string; body: string; next: ReactNode }) {
  // Lessons written before the prompt fix hold HTML line breaks.
  const markdown = body.replace(/<br\s*\/?>/gi, "\n");
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4.5rem)] max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="my-auto">
        <h1 className="font-display text-3xl font-black">{title}</h1>
        <div className="learn-md mt-4 font-semibold">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{ pre: ({ node, ...props }) => <pre tabIndex={0} className={`chunk overflow-x-auto bg-white p-4 text-sm ${FOCUS}`} {...props} /> }}
          >
            {markdown}
          </ReactMarkdown>
        </div>
      </div>
      <div className="mt-auto pt-8">{next}</div>
    </main>
  );
}

function WatchView({ title, part, next }: { title: string; part: Extract<Part, { kind: "watch" }>; next: ReactNode }) {
  const timeline = useMemo(() => {
    try {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: part.hunks }]);
    } catch {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: [] }]); // a bad hunk must not blank the player
    }
  }, [part]);
  const panel = (
    <div>
      <p className="font-semibold">Watch the code being written. Use the controls to pause or seek.</p>
      {next}
    </div>
  );
  return <Player title={title} stepTitles={[title]} timeline={timeline} live={{ idx: 0, panel, playKey: part }} />;
}

function PracticeView({ title, part, next }: { title: string; part: Extract<Part, { kind: "practice" }>; next: ReactNode }) {
  const [code, setCode] = useState(part.starterCode);
  const [out, setOut] = useState<{ output: string; error?: string } | null>(null);
  const [verdict, setVerdict] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (check: boolean) => {
    setBusy(true);
    setVerdict("");
    const r = await runJs(code);
    setOut(r);
    if (check) setVerdict(!r.error && r.output.trim() === part.expectedOutput.trim() ? "Correct!" : "Not quite. Compare your output with the task.");
    setBusy(false);
  };
  return (
    <main className="mx-auto grid min-h-dvh max-w-6xl gap-4 px-4 py-6 sm:px-6 lg:grid-cols-2">
      <section>
        <h1 className="font-display text-3xl font-black">{title}</h1>
        <p className="mt-4 whitespace-pre-wrap font-semibold">{part.instructions}</p>
        {next}
      </section>
      <section className="flex flex-col gap-3">
        <div className="chunk h-[50dvh] overflow-hidden bg-white">
          <Editor language="javascript" theme="vs" value={code} onChange={(v) => setCode(v ?? "")} options={{ ariaLabel: "Your code", minimap: { enabled: false }, automaticLayout: true, fontSize: 14 }} />
        </div>
        <div className="flex gap-3">
          <button type="button" disabled={busy} onClick={() => go(false)} className="btn !px-6 !py-2">Run</button>
          <button type="button" disabled={busy} onClick={() => go(true)} className="pill bg-white px-5 py-2">Check</button>
        </div>
        <pre aria-label="Output" tabIndex={0} className={`chunk min-h-24 overflow-auto bg-white p-3 text-sm ${FOCUS}`}>{out ? `${out.output}${out.error ? `\n${out.error}` : ""}` : "Run your code to see its output."}</pre>
        <p role="status" aria-live="polite" className="font-extrabold">{verdict}</p>
      </section>
    </main>
  );
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
