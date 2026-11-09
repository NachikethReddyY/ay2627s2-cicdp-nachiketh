import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buildTimeline } from "@learnquest/player-core";
import EditorPane from "../EditorPane";
import { createShellSocket, type ShellSocket } from "../terminal/shellSocket";
import TerminalPanel from "../terminal/TerminalPanel";
import { isToggleKey, usePanel } from "../terminal/usePanel";
import { RunInShellError, runInShell } from "../terminal/runInShell";
import { checkPractice, pollPython, putFile, sendPythonLine, startPython, stopPython, type PyPoll } from "../runPython";
import { FOCUS } from "../ui";
import { Player } from "./LazyPlayer";
import { practiceActions, shouldFallBack, skipShellWait } from "./practiceActions";
import CheckPanel from "./CheckPanel";
import { monacoLanguage, solutionFile, type CheckResponse, type PracticeLanguage, type PracticeTest } from "./checkModel";
import type { Part } from "./types";

const SloppyPanel = lazy(() => import("./SloppyPanel"));

// The API's part type lists python and javascript; the practice view also takes typescript and a list of tests.
type PracticePart = Omit<Extract<Part, { kind: "practice" }>, "language"> & { language?: PracticeLanguage; tests?: PracticeTest[] };

const MAX_POLL_FAILURES = 4;

// Practice is the player's desktop without the replay: Instructions and code windows, the Dock, Check + Next in the menu bar.
export default function PracticeView({ lessonId, title, part, next }: { lessonId: string; title: string; part: Extract<Part, { kind: "practice" }>; next: ReactNode }) {
  const [code, setCode] = useState(part.starterCode);
  const [term, setTerm] = useState(""); // what the terminal shows: program output plus the answers typed
  const [result, setResult] = useState<CheckResponse | null>(null); // the last Check
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [sloppyOpen, setSloppyOpen] = useState(false);
  const [sid, setSid] = useState<string | null>(null); // the live run, if any
  const [starting, setStarting] = useState(false); // a run request is in flight; sid is not set yet
  const sidRef = useRef<string | null>(null); // mirrors sid so the unmount cleanup can stop the run
  const live = useRef(true); // false once the page is gone, so a late startPython result is stopped
  const [typed, setTyped] = useState("");
  const stdout = useRef(""); // program output only, without the echoed answers
  const runRef = useRef<HTMLButtonElement>(null);
  const timeline = useMemo(() => buildTimeline([{ beforeFiles: {}, hunks: [] }]), []);
  const bodyRef = useRef<HTMLDivElement>(null);
  // One socket per mount, created in the effect so StrictMode's simulated unmount (which disposes it) gets a fresh one.
  const [shell, setShell] = useState<ShellSocket | null>(null);
  useEffect(() => {
    const s = createShellSocket();
    setShell(s);
    return () => {
      s.dispose();
      setShell(null);
    };
  }, []);
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [shellRun, setShellRun] = useState(false); // a Run is copying the code into the shell
  const [runNote, setRunNote] = useState<string | undefined>();
  const shellUnreachable = useRef(false); // a Run fell back because the socket is failing; cleared once the shell is ready again
  const readyTimeouts = useRef(0); // consecutive Run waits that hit the readiness timeout; reset once the shell is ready
  useEffect(() => {
    if (!shell) return;
    const track = () => {
      const s = shell.state();
      setSandboxEnabled(!(s.kind === "closed" && s.reason === "disabled"));
    };
    track();
    return shell.onState((st) => {
      track();
      if (st.kind === "open" && st.ready) {
        shellUnreachable.current = false;
        readyTimeouts.current = 0;
        setRunNote(undefined);
      }
    });
  }, [shell]);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const panel = usePanel(bodyRef);
  const { dispatch: panelDispatch } = panel;
  const [treeKey, setTreeKey] = useState(0);
  // Capture phase, so Ctrl+` toggles the panel even while the editor or the terminal has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleKey(e)) return;
      if (e.repeat) { e.preventDefault(); return; }
      e.preventDefault();
      panelDispatch({ type: "toggle" });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelDispatch]);
  useEffect(() => {
    if (wasOpen.current && !panel.state.open) {
      // Only reclaim focus if it was in the panel (or already lost); never pull it from the editor.
      const a = document.activeElement;
      if (!a || a === document.body || a.closest('[aria-label="Terminal panel"]')) toggleRef.current?.focus();
    }
    wasOpen.current = panel.state.open;
  }, [panel.state.open]);
  const language = monacoLanguage((part as PracticePart).language);
  const python = language === "python";
  const msg = (e: unknown) => (e instanceof Error ? e.message : "Could not run the code");
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
    let failures = 0; // consecutive failed polls; a transient network blip should not end the run
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let p: PyPoll;
      try {
        p = await pollPython(sid, from);
      } catch (e) {
        if (!live) return;
        if (++failures < MAX_POLL_FAILURES) { timer = setTimeout(poll, 300 * failures); return; }
        setTerm((t) => `${t}\n${msg(e)}\n`);
        // Giving up hides Stop, and a cleared sid can't be stopped on unmount, so stop the run now:
        // otherwise it holds one of the learner's two run slots until the server times it out.
        void stopPython(sid).catch(() => {});
        setSid(null);
        return;
      }
      if (!live) return;
      failures = 0;
      from = p.next;
      if (p.output) { stdout.current += p.output; setTerm((t) => t + p.output); }
      if (!p.done) { timer = setTimeout(poll, 300); return; }
      if (p.error) setTerm((t) => `${t}${t && !t.endsWith("\n") ? "\n" : ""}${p.error}\n`);
      else if (!stdout.current) setTerm((t) => t || "The program ran and printed nothing.");
      setSid(null);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [sid]);

  const oneShot = async (args: Parameters<typeof startPython>) => {
    stdout.current = "";
    setTerm("");
    setStarting(true);
    let id: string;
    try {
      id = (await startPython(...args)).id;
    } catch (e) {
      if (!live.current) return;
      setStarting(false);
      setTerm(msg(e));
      return;
    }
    if (!live.current) { void stopPython(id).catch(() => {}); return; } // the page closed while the request was pending
    setStarting(false);
    setSid(id);
  };
  const actionsFor = (enabled: boolean) => practiceActions({ language, code, lessonId, sandboxEnabled: enabled });
  const check = async () => {
    setCheckBusy(true);
    setCheckError("");
    try {
      const res = await checkPractice(...actionsFor(sandboxEnabled).check.args);
      if (live.current) setResult(res);
    } catch (e) {
      if (live.current) { setResult(null); setCheckError(msg(e)); }
    }
    if (live.current) setCheckBusy(false);
  };
  const run = async () => {
    const a = actionsFor(sandboxEnabled).run;
    if (a.via === "oneshot") { await oneShot(a.args); return; }
    if (!shell) return;
    if (skipShellWait(shellUnreachable.current, shell.state())) {
      setRunNote(undefined);
      const fb = actionsFor(false).run;
      if (fb.via === "oneshot") await oneShot(fb.args);
      return;
    }
    setRunNote(undefined);
    setShellRun(true);
    stdout.current = "";
    setTerm("");
    try {
      await runInShell({
        language: python ? "python" : "javascript",
        code,
        panel: { open: () => panelDispatch({ type: "open" }) },
        socket: shell,
        putFile,
        refreshTree: () => setTreeKey((k) => k + 1),
      });
    } catch (e) {
      if (!live.current) return;
      if (e instanceof RunInShellError && e.kind === "starting") readyTimeouts.current += 1;
      if (e instanceof RunInShellError && shouldFallBack(e.kind, shell.state(), readyTimeouts.current)) {
        shellUnreachable.current = true;
        setShellRun(false);
        const fb = actionsFor(false).run;
        if (fb.via === "oneshot") await oneShot(fb.args);
        return;
      }
      setRunNote(msg(e));
    }
    if (live.current) setShellRun(false);
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
  const showCheckOutput = sid !== null || starting || term !== "";
  const file = solutionFile(language);
  const body = (
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      <EditorPane transportRef={runRef} edit={{ value: code, language, onChange: setCode }} />
      {shell && <TerminalPanel shell={shell} panel={panel} badge={null} note={runNote} treeKey={treeKey} onRefreshTree={() => setTreeKey((k) => k + 1)} />}
      {showCheckOutput && (
      <section aria-labelledby="out-h" className="flex max-h-[45%] min-h-32 flex-none flex-col border-t-[3px] border-ink bg-ink font-mono text-white">
        <div className="flex flex-none items-center gap-2 border-b-2 border-white/20 px-3 py-1">
          <h3 id="out-h" className="text-sm font-extrabold">Output</h3>
          {sid && (
            <button type="button" onClick={stop} className={`pill ml-auto flex min-h-7 items-center gap-1 bg-pink px-3 text-sm font-extrabold text-ink ${FOCUS}`}>
              <span aria-hidden="true">■</span> Stop
            </button>
          )}
        </div>
        <pre aria-label="Output" tabIndex={0} className={`min-h-0 flex-1 overflow-auto p-3 text-sm whitespace-pre-wrap ${FOCUS}`}>{term}</pre>
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
      )}
      {checkError && <p role="alert" className="m-0 flex-none border-t-[3px] border-ink bg-pink px-3 py-2 text-sm font-extrabold text-ink">{checkError}</p>}
      <CheckPanel result={result} tests={(part as PracticePart).tests} />
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
            <button ref={toggleRef} type="button" aria-pressed={panel.state.open} onClick={() => panelDispatch({ type: "toggle" })} className={`btn ${FOCUS}`}>Terminal</button>
            <button type="button" disabled={starting || sid !== null || shellRun || checkBusy} onClick={() => void check()} className={`btn check ${FOCUS}`}>{checkBusy ? "Checking…" : "Check"}</button>
            <button type="button" aria-pressed={sloppyOpen} onClick={() => setSloppyOpen((o) => !o)} className={`btn ${FOCUS}`}>Sloppy</button>
            {next}
          </>
        ),
        code: {
          title: file,
          tool: (
            <button ref={runRef} type="button" disabled={starting || sid !== null || shellRun} onClick={() => void run()} className={`pill flex min-h-7 items-center gap-1 bg-green px-3 text-sm font-extrabold ${FOCUS}`}>
              <span aria-hidden="true">▶</span> Run
            </button>
          ),
          body: (
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
              {sloppyOpen && <Suspense fallback={null}><SloppyPanel fileName={file} code={code} language={language} /></Suspense>}
            </div>
          ),
        },
      }}
    />
  );
}
