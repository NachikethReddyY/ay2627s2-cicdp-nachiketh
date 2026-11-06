import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buildTimeline } from "@learnquest/player-core";
import EditorPane from "../EditorPane";
import { createShellSocket } from "../terminal/shellSocket";
import TerminalPanel from "../terminal/TerminalPanel";
import { isToggleKey, usePanel } from "../terminal/usePanel";
import { checkPassed, pollPython, sendPythonLine, startPython, stopPython, type PyPoll } from "../runPython";
import { FOCUS } from "../ui";
import { Player } from "./LazyPlayer";
import type { Part } from "./types";

const MAX_POLL_FAILURES = 4;

// Practice is the player's desktop without the replay: Instructions and code windows, the Dock, Check + Next in the menu bar.
export default function PracticeView({ lessonId, title, part, next }: { lessonId: string; title: string; part: Extract<Part, { kind: "practice" }>; next: ReactNode }) {
  const [code, setCode] = useState(part.starterCode);
  const [term, setTerm] = useState(""); // what the terminal shows: program output plus the answers typed
  const [ok, setOk] = useState<boolean | null>(null);
  const [sid, setSid] = useState<string | null>(null); // the live run, if any
  const [starting, setStarting] = useState(false); // a run request is in flight; sid is not set yet
  const sidRef = useRef<string | null>(null); // mirrors sid so the unmount cleanup can stop the run
  const live = useRef(true); // false once the page is gone, so a late startPython result is stopped
  const [typed, setTyped] = useState("");
  const stdout = useRef(""); // program output only, without the echoed answers
  const checking = useRef(false);
  const runRef = useRef<HTMLButtonElement>(null);
  const timeline = useMemo(() => buildTimeline([{ beforeFiles: {}, hunks: [] }]), []);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shell = useMemo(() => createShellSocket(), []);
  useEffect(() => () => shell.dispose(), [shell]);
  const panel = usePanel(bodyRef);
  const { dispatch: panelDispatch } = panel;
  const [treeKey, setTreeKey] = useState(0);
  // Capture phase, so Ctrl+` toggles the panel even while the editor or the terminal has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleKey(e)) return;
      e.preventDefault();
      panelDispatch({ type: "toggle" });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelDispatch]);
  const python = part.language === "python";
  const msg = (e: unknown) => (e instanceof Error ? e.message : "Could not run the code");
  // The server judges a Check run and records the completion; the player only shows its verdict.
  const judge = (p: Pick<PyPoll, "error" | "passed">) => {
    if (!checking.current) return;
    setOk(checkPassed(p));
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
      judge(p);
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
      id = (await startPython(code, python ? "python" : "javascript", check ? lessonId : undefined)).id;
    } catch (e) {
      if (!live.current) return;
      setStarting(false);
      setTerm(msg(e));
      judge({ error: msg(e) });
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
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      <EditorPane transportRef={runRef} edit={{ value: code, language: part.language ?? "javascript", onChange: setCode }} />
      <TerminalPanel shell={shell} panel={panel} badge={null} treeKey={treeKey} onRefreshTree={() => setTreeKey((k) => k + 1)} />
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
            <button type="button" aria-pressed={panel.state.open} onClick={() => panelDispatch({ type: "toggle" })} className={`btn ${FOCUS}`}>Terminal</button>
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
