import { useEffect, useRef, useState } from "react";
import { createShellSocket, type ShellSocket, type ShellState } from "../terminal/shellSocket";
import { checkPractice, lintPractice, pollPython, startPython, stopPython, type LintFinding, type PyPoll } from "../runPython";
import { lintErrorMessage } from "./lintModel";
import { outputTail } from "./lessonWorkbenchModel";
import { createRunGate, createRunQueue, withDeadline } from "./runQueue";
import type { CheckResponse, PracticeLanguage } from "./checkModel";

const MAX_POLL_FAILURES = 4;
const MAX_OUTPUT = 100_000;
const START_TIMEOUT_MS = 10_000;
const POLL_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 3_000;
const msg = (e: unknown) => {
  if (!(e instanceof Error)) return "Could not run the code";
  return e.name === "TimeoutError" ? "The sandbox took too long to respond" : e.message;
};

type Options = { lessonId: string; versionId?: string; revision?: string; language: PracticeLanguage; code: string; openTerminal: () => void; workspace?: string; onLint?: (findings: LintFinding[]) => void; startShell?: boolean; standalone?: boolean };
type TerminalSession = { id: string; label: string; socket: ShellSocket };
const PRIMARY_TERMINAL = "practice";

export function usePracticeRunner({ lessonId, versionId, revision, language, code, openTerminal, workspace, onLint, startShell = false, standalone = false }: Options) {
  const [term, setTerm] = useState("");
  const [attemptCount, setAttemptCount] = useState(0);
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [findings, setFindings] = useState<LintFinding[] | null>(null);
  const [lintBusy, setLintBusy] = useState(false);
  const [lintError, setLintError] = useState("");
  const [sid, setSid] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [additionalTerminals, setAdditionalTerminals] = useState<TerminalSession[]>([]);
  const terminalSessionsRef = useRef<TerminalSession[]>([]);
  const [activeTerminal, setActiveTerminal] = useState(PRIMARY_TERMINAL);
  const [splitTerminals, setSplitTerminals] = useState(false);
  const sessionNumber = useRef(1);
  const [bottomView, setBottomView] = useState<"main" | "console">("main");
  const [shellState, setShellState] = useState<ShellState>({ kind: "idle" });
  const sidRef = useRef<string | null>(null);
  const live = useRef(true);
  const stdout = useRef("");
  const lintSeq = useRef(0);
  const codeRevision = useRef(0);
  const runNow = useRef<(job: string) => Promise<void>>(async () => {});
  const [runGate] = useState(createRunGate);
  const [enqueue] = useState(() => createRunQueue<string>((job) => runNow.current(job), { isLive: () => live.current }));
  const [stopThenRelease] = useState(() => (id: string) => {
    void withDeadline((signal) => stopPython(id, signal), STOP_TIMEOUT_MS)
      .catch(() => {})
      .then(() => runGate.release());
  });
  const append = (text: string) => setTerm((t) => outputTail(t + text, MAX_OUTPUT));

  const [shell, setShell] = useState<ShellSocket | null>(null);
  useEffect(() => {
    if (standalone) return;
    const s = createShellSocket({ workspace });
    if (startShell) {
      s.setActive(false);
      s.connect();
    }
    setShell(s);
    return () => {
      s.dispose();
      for (const terminal of terminalSessionsRef.current) terminal.socket.dispose();
      terminalSessionsRef.current = [];
      setShell(null);
    };
  }, [standalone, startShell, workspace]);
  useEffect(() => {
    if (!shell) return;
    setShellState(shell.state());
    return shell.onState(setShellState);
  }, [shell]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (sidRef.current) stopThenRelease(sidRef.current);
      else runGate.release();
    };
  }, [runGate, stopThenRelease]);

  useEffect(() => {
    if (!sid) return;
    let from = 0;
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let p: PyPoll;
      try {
        p = await withDeadline((signal) => pollPython(sid, from, signal), POLL_TIMEOUT_MS);
      } catch (e) {
        if (!alive) return;
        if (++failures < MAX_POLL_FAILURES) { timer = setTimeout(poll, 300 * failures); return; }
        append(`\n${msg(e)}\n`);
        sidRef.current = null;
        stopThenRelease(sid);
        setSid(null);
        return;
      }
      if (!alive) return;
      failures = 0;
      from = p.next;
      if (p.output) { stdout.current += p.output; append(p.output); }
      if (!p.done) { timer = setTimeout(poll, 300); return; }
      if (p.error) append(`${p.error}\n`);
      else if (!stdout.current) append("The program ran and printed nothing.\n");
      sidRef.current = null;
      setSid(null);
      runGate.release();
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [sid, runGate, stopThenRelease]);

  runNow.current = async (source) => {
    if (!live.current) return;
    stdout.current = "";
    setBottomView("console");
    openTerminal();
    setTerm((current) => outputTail(`${current}${current ? "\n" : ""}[Run]\n`, MAX_OUTPUT));
    setStarting(true);
    let id: string;
    try {
      id = (await withDeadline((signal) => startPython(source, language, undefined, signal, ""), START_TIMEOUT_MS)).id;
    } catch (e) {
      if (!live.current) return;
      setStarting(false);
      append(`${msg(e)}\n`);
      return;
    }
    if (!live.current) { void stopPython(id).catch(() => {}); return; }
    setStarting(false);
    const finished = runGate.wait();
    sidRef.current = id;
    setSid(id);
    await finished;
  };

  const resetResults = () => {
    codeRevision.current++;
    lintSeq.current++;
    setResult(null);
    setCheckError("");
    setFindings(null);
    onLint?.([]);
    setLintError("");
    setLintBusy(false);
  };
  const lint = async () => {
    const seq = ++lintSeq.current;
    setLintBusy(true);
    setLintError("");
    try {
      const res = await lintPractice(code, language);
      if (live.current && seq === lintSeq.current) {
        setFindings(res.findings);
        onLint?.(res.findings);
      }
    } catch (e) {
      if (live.current && seq === lintSeq.current) { setFindings(null); onLint?.([]); setLintError(lintErrorMessage(e)); }
    }
    if (live.current && seq === lintSeq.current) setLintBusy(false);
  };
  const check = async () => {
    const revisionAtSubmit = codeRevision.current;
    void lint();
    setCheckBusy(true);
    setCheckError("");
    try {
      const res = await checkPractice({ code, language, lessonId, versionId, revision });
      if (live.current) {
        setAttemptCount(res.attemptCount);
        if (revisionAtSubmit === codeRevision.current) setResult(res);
      }
      return res.lessonJustCompleted === true;
    } catch (e) {
      if (live.current && revisionAtSubmit === codeRevision.current) { setResult(null); setCheckError(msg(e)); }
      return false;
    } finally {
      if (live.current) setCheckBusy(false);
    }
  };
  const terminals = shell ? [{ id: PRIMARY_TERMINAL, label: "Terminal 1", socket: shell }, ...additionalTerminals] : [];
  const selectTerminal = (id: string) => {
    setActiveTerminal(id);
    setBottomView("main");
  };
  const newTerminal = () => {
    if (!shell || terminalSessionsRef.current.length >= 3) return;
    const id = crypto.randomUUID();
    const socket = createShellSocket({ tabId: id, workspace });
    terminalSessionsRef.current = [...terminalSessionsRef.current, { id, label: `Terminal ${++sessionNumber.current}`, socket }];
    setAdditionalTerminals(terminalSessionsRef.current);
    socket.setActive(false);
    socket.connect();
    selectTerminal(id);
  };
  const toggleSplit = () => {
    if (!shell) return;
    if (!splitTerminals && terminals.length === 1) newTerminal();
    setBottomView("main");
    setSplitTerminals(!splitTerminals);
  };
  const closeTerminal = (id: string) => {
    const terminal = terminalSessionsRef.current.find((item) => item.id === id);
    if (!terminal) return;
    terminal.socket.dispose();
    terminalSessionsRef.current = terminalSessionsRef.current.filter((item) => item.id !== id);
    setAdditionalTerminals(terminalSessionsRef.current);
    if (activeTerminal === id) selectTerminal(PRIMARY_TERMINAL);
    if (terminalSessionsRef.current.length === 0) setSplitTerminals(false);
  };

  const run = (source: string = code) => enqueue(source);
  const runAuthored = run;
  const stop = () => {
    if (!sid || sidRef.current !== sid) return;
    sidRef.current = null;
    stopThenRelease(sid);
    setSid(null);
    append("\n[stopped]\n");
  };

  return {
    shell, shellState, terminals, activeTerminal, splitTerminals, selectTerminal, newTerminal, toggleSplit, closeTerminal, term, sid, starting, bottomView, setBottomView,
    result, attemptCount, checkBusy, checkError, findings, lintBusy, lintError,
    busy: starting || sid !== null,
    showOutput: sid !== null || starting || term !== "",
    run, runAuthored, check, lint, stop, resetResults,
  };
}
