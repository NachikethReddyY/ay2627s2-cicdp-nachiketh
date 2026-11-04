import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMachine } from "@xstate/react";
import { buildTimeline } from "@learnquest/player-core";
import { TRPCClientError } from "@trpc/client";
import { trpc, isNotFound, type RouterOutputs } from "../lib/trpc";
import { useApi } from "../lib/api";
import EditorPane from "./EditorPane";
import { Player } from "./PlayerPage";
import { pollPython, sendPythonLine, startPython, stopPython, type PyPoll } from "./runPython";
import { FOCUS } from "./ui";
import { Bar } from "../components/Bits";
import { PredictPanel, RevealPanel } from "./LivePanels";
import { LearnView } from "./LearnView.tsx";
import { GamePracticeView } from "./GamePracticeView.tsx";
import { canHint, canSkip, canSubmit, stepMachine, type Reveal } from "./stepMachine";

type Lesson = RouterOutputs["lessons"]["get"];

function Notice({ pip = "pip-think", children }: { pip?: string; children: ReactNode }) {
  return (
    <div className="lq player-notice grid min-h-dvh place-items-center p-6">
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
  // Reading or watching a part counts it as finished; practice and games are completed server-side. Errors are ignored.
  const readKind = data?.kind === "learn" || data?.kind === "watch";
  useEffect(() => {
    if (data && readKind) void trpc.parts.complete.mutate({ lessonId: data.id }).catch(() => {});
  }, [data?.id, readKind]);

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
    return <div className="flex h-dvh flex-col">{progress}<LearnView title={data.title} body={part.body} doc={part.doc} next={next} /></div>;
  if (data.kind === "watch" && part?.kind === "watch")
    return <WatchView title={data.title} part={part} next={next} />; // codecasts: no course progress strip
  if (data.kind === "practice" && part?.kind === "practice")
    return <PracticeView lessonId={data.id} title={data.title} part={part} next={next} />;
  if (data.kind === "game-practice" && part?.kind === "game-practice")
    return <div className="flex h-dvh flex-col">{progress}<GamePracticeView lessonId={data.id} title={data.title} intro={part.intro} doc={part.doc} next={next} /></div>;
  return <>{progress}<Steps lesson={data} /></>;
}

// Where this part sits in its course, so the learner knows how many are left.
function LessonProgress({ id, course }: { id: string; course: string }) {
  const { data } = useApi(`course:${course}`, () => trpc.courses.get.query({ slug: course }));
  const i = data?.lessons.findIndex((l) => l.slug === id) ?? -1;
  if (!data || i < 0) return null;
  const total = data.lessons.length;
  return (
    <div className="sticky top-0 z-30 px-4 pt-3 pb-2 backdrop-blur" style={{ background: "#fff4e0" }}>
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

function WatchView({ title, part, next }: { title: string; part: Extract<Part, { kind: "watch" }>; next: ReactNode }) {
  const timeline = useMemo(() => {
    try {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: part.hunks }]);
    } catch {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: [] }]); // a bad hunk must not blank the player
    }
  }, [part]);
  // A codecast is video only: no instructions window; Next sits under the player.
  return <Player title={title} stepTitles={[title]} timeline={timeline} live={{ idx: 0, panel: null, footer: next, playKey: part }} />;
}

// Practice is the player's desktop without the replay: Instructions and code windows, the Dock, Check + Next in the menu bar.
function PracticeView({ lessonId, title, part, next }: { lessonId: string; title: string; part: Extract<Part, { kind: "practice" }>; next: ReactNode }) {
  const [code, setCode] = useState(part.starterCode);
  const [term, setTerm] = useState(""); // what the terminal shows: program output plus the answers typed
  const [ok, setOk] = useState<boolean | null>(null);
  const [sid, setSid] = useState<string | null>(null); // the live run, if any
  const [starting, setStarting] = useState(false); // a run request is in flight; sid is not set yet
  const sidRef = useRef<string | null>(null); // mirrors sid so the unmount cleanup can stop the run
  const live = useRef(true); // false once the page is gone, so a late startPython result is stopped
  const [typed, setTyped] = useState("");
  const stdout = useRef(""); // program output only, without the echoed answers; Check compares this
  const checking = useRef(false);
  const runRef = useRef<HTMLButtonElement>(null);
  const timeline = useMemo(() => buildTimeline([{ beforeFiles: {}, hunks: [] }]), []);
  const python = part.language === "python";
  const msg = (e: unknown) => (e instanceof Error ? e.message : "Could not run the code");
  const judge = (out: string, error?: string) => {
    if (!checking.current) return;
    const pass = !error && out.trim() === part.expectedOutput.trim();
    setOk(pass);
  };

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (sidRef.current) void stopPython(sidRef.current).catch(() => {});
    };
  }, []);
  useEffect(() => { sidRef.current = sid; }, [sid]);

  // Follows a live Python run: new output is appended as it arrives, until the program ends.
  useEffect(() => {
    if (!sid) return;
    let from = 0;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let p: PyPoll;
      try {
        p = await pollPython(sid, from);
      } catch (e) {
        if (live) { setTerm((t) => `${t}\n${msg(e)}\n`); setSid(null); }
        return;
      }
      if (!live) return;
      from = p.next;
      if (p.output) { stdout.current += p.output; setTerm((t) => t + p.output); }
      if (!p.done) { timer = setTimeout(poll, 300); return; }
      if (p.error) setTerm((t) => `${t}${t && !t.endsWith("\n") ? "\n" : ""}${p.error}\n`);
      else if (!stdout.current) setTerm((t) => t || "The program ran and printed nothing.");
      judge(stdout.current, p.error);
      setSid(null);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [sid]);

  const run = async (check: boolean) => {
    checking.current = check;
    setOk(null); // clearing first remounts the badge, so its animation plays on every check
    stdout.current = "";
    setTerm("");
    setStarting(true);
    let id: string;
    try {
      id = (await startPython(code, python ? "python" : "javascript")).id;
    } catch (e) {
      if (!live.current) return;
      setStarting(false);
      setTerm(msg(e));
      judge("", msg(e));
      return;
    }
    if (!live.current) { void stopPython(id).catch(() => {}); return; } // the page closed while the request was pending
    setStarting(false);
    setSid(id);
  };
  const stop = () => {
    if (!sid) return;
    void stopPython(sid).catch(() => {});
    setSid(null);
    setTerm((t) => `${t}\n[stopped]\n`);
  };
  const answer = (e: FormEvent) => {
    e.preventDefault();
    if (!sid) return;
    const line = typed;
    setTyped("");
    setTerm((t) => `${t}${line}\n`);
    void sendPythonLine(sid, line).catch(() => setTerm((t) => `${t}[could not send that line]\n`));
  };
  const file = python ? "solution.py" : "solution.js";
  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorPane transportRef={runRef} edit={{ value: code, language: part.language ?? "javascript", onChange: setCode }} />
      <section aria-labelledby="out-h" className="flex max-h-[45%] min-h-32 flex-none flex-col border-t-[3px] border-ink bg-ink font-mono text-white">
        <div className="flex flex-none items-center gap-2 border-b-2 border-white/20 px-3 py-1">
          <h3 id="out-h" className="text-sm font-extrabold">Terminal</h3>
          <span role="status" aria-live="polite" className="ml-auto">
            {ok !== null && (
              <span className={`inline-block rounded-lg border-2 border-ink px-2 py-0.5 font-sans text-sm font-extrabold text-ink ${ok ? "verdict-ok bg-green" : "verdict-no bg-pink"}`}>
                {ok ? "Correct!" : "Not quite. Compare your output with the task."}
              </span>
            )}
          </span>
        </div>
        <pre aria-label="Output" tabIndex={0} className={`min-h-0 flex-1 overflow-auto p-3 text-sm whitespace-pre-wrap ${FOCUS}`}>{term || "Run your code to see its output."}</pre>
        {sid && (
          <form onSubmit={answer} className="flex flex-none items-center gap-2 border-t-2 border-white/20 px-3 py-2 text-sm">
            <span aria-hidden="true" className="font-extrabold">{">"}</span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Type your answer and press Enter"
              autoComplete="off"
              spellCheck={false}
              className={`min-w-0 flex-1 bg-transparent text-white caret-white outline-none placeholder:text-white/50 ${FOCUS}`}
              placeholder="type your answer, then Enter"
            />
          </form>
        )}
      </section>
    </div>
  );
  return (
    <Player
      title={title}
      stepTitles={[title]}
      timeline={timeline}
      live={{
        idx: 0,
        playKey: null,
        panel: <p className="whitespace-pre-wrap font-semibold">{part.instructions}</p>,
        footer: (
          <>
            <button type="button" disabled={starting || sid !== null} onClick={() => run(true)} className={`btn check ${FOCUS}`}>Check</button>
            {next}
          </>
        ),
        code: {
          title: file,
          tool: sid ? (
            <button ref={runRef} type="button" onClick={stop} className={`pill flex min-h-7 items-center gap-1 bg-pink px-3 text-sm font-extrabold ${FOCUS}`}>
              <span aria-hidden="true">■</span> Stop
            </button>
          ) : (
            <button ref={runRef} type="button" disabled={starting} onClick={() => run(false)} className={`pill flex min-h-7 items-center gap-1 bg-green px-3 text-sm font-extrabold ${FOCUS}`}>
              <span aria-hidden="true">▶</span> Run
            </button>
          ),
          body,
        },
      }}
    />
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
