import { useEffect, useRef, useState, type FormEvent } from "react";
import { createShellSocket, type ShellSocket, type ShellState } from "../terminal/shellSocket";
import { RunInShellError, STILL_RUNNING, runInShell } from "../terminal/runInShell";
import { checkPractice, lintPractice, pollPython, putFile, sendPythonLine, startPython, stopPython, type LintFinding, type PyPoll } from "../runPython";
import { practiceActions, shouldFallBack, skipShellWait } from "./practiceActions";
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

type Options = { lessonId: string; versionId?: string; revision?: string; language: PracticeLanguage; code: string; openTerminal: () => void; refreshTree?: () => void; onLint?: (findings: LintFinding[]) => void; startShell?: boolean; standalone?: boolean };
type RunJob = { source: string; authored: boolean };

export function usePracticeRunner({ lessonId, versionId, revision, language, code, openTerminal, refreshTree, onLint, startShell = false, standalone = false }: Options) {
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
  const [typed, setTyped] = useState("");
  const [shellRun, setShellRun] = useState(false);
  const [runNote, setRunNote] = useState<string | undefined>();
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [shellState, setShellState] = useState<ShellState>({ kind: "idle" });
  const sidRef = useRef<string | null>(null);
  const live = useRef(true);
  const stdout = useRef("");
  const shellUnreachable = useRef(false);
  const readyTimeouts = useRef(0);
  const lintSeq = useRef(0);
  const codeRevision = useRef(0);
  const runNow = useRef<(job: RunJob) => Promise<void>>(async () => {});
  const [runGate] = useState(createRunGate);
  const [enqueue] = useState(() => createRunQueue<RunJob>((job) => runNow.current(job), { isLive: () => live.current }));
  const [stopThenRelease] = useState(() => (id: string) => {
    void withDeadline((signal) => stopPython(id, signal), STOP_TIMEOUT_MS)
      .catch(() => {})
      .then(() => runGate.release());
  });
  const append = (text: string) => setTerm((t) => outputTail(t + text, MAX_OUTPUT));

  const [shell, setShell] = useState<ShellSocket | null>(null);
  useEffect(() => {
    if (standalone) return;
    const s = createShellSocket();
    if (startShell) {
      s.setActive(false);
      s.connect();
    }
    setShell(s);
    return () => {
      s.dispose();
      setShell(null);
    };
  }, [standalone, startShell]);
  useEffect(() => {
    if (!shell) return;
    const track = () => {
      const s = shell.state();
      setShellState(s);
      setSandboxEnabled(!(s.kind === "closed" && s.reason === "disabled"));
    };
    track();
    return shell.onState((st) => {
      track();
      if (st.kind === "open" && st.ready) {
        readyTimeouts.current = 0;
        setRunNote(undefined);
      }
    });
  }, [shell]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (sidRef.current) stopThenRelease(sidRef.current);
      else runGate.release();
    };
  }, [runGate, stopThenRelease]);
  useEffect(() => { sidRef.current = sid; }, [sid]);

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
      setSid(null);
      runGate.release();
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [sid, runGate, stopThenRelease]);

  const oneShot = async (args: Parameters<typeof startPython>) => {
    if (!live.current) return;
    stdout.current = "";
    openTerminal();
    setTerm((current) => outputTail(`${current}${current ? "\n" : ""}[Run]\n`, MAX_OUTPUT));
    setStarting(true);
    let id: string;
    try {
      id = (await withDeadline((signal) => startPython(args[0], args[1], args[2], signal), START_TIMEOUT_MS)).id;
    } catch (e) {
      if (!live.current) return;
      setStarting(false);
      append(`${msg(e)}\n`);
      return;
    }
    if (!live.current) { void stopPython(id).catch(() => {}); return; }
    setStarting(false);
    const finished = runGate.wait();
    setSid(id);
    await finished;
  };
  const actionsFor = (enabled: boolean, source: string = code, authored = false) => practiceActions({ language, code: source, lessonId, versionId, revision, sandboxEnabled: enabled, authored });

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
      const res = await checkPractice(...actionsFor(sandboxEnabled).check.args);
      if (live.current) {
        setAttemptCount(res.attemptCount);
        if (revisionAtSubmit === codeRevision.current) setResult(res);
      }
    } catch (e) {
      if (live.current && revisionAtSubmit === codeRevision.current) { setResult(null); setCheckError(msg(e)); }
    }
    if (live.current) setCheckBusy(false);
  };
  runNow.current = async ({ source, authored }) => {
    const a = actionsFor(sandboxEnabled && !standalone, source, authored).run;
    if (a.via === "oneshot") { await oneShot(a.args); return; }
    if (!shell) return;
    if (shellUnreachable.current || skipShellWait(false, shell.state())) {
      setRunNote(undefined);
      const fb = actionsFor(false, source).run;
      if (fb.via === "oneshot") await oneShot(fb.args);
      return;
    }
    setRunNote(undefined);
    setShellRun(true);
    try {
      const end = await runInShell({
        language: language === "python" ? "python" : "javascript",
        code: source,
        panel: { open: openTerminal },
        socket: shell,
        putFile,
        refreshTree: () => refreshTree?.(),
        onTimeout: () => live.current && setRunNote(STILL_RUNNING),
      });
      if (end === "timeout" && live.current) setRunNote(undefined);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof RunInShellError && e.kind === "starting") readyTimeouts.current += 1;
      if (e instanceof RunInShellError && e.kind === "unavailable") shellUnreachable.current = true;
      if (e instanceof RunInShellError && shouldFallBack(e.kind, shell.state(), readyTimeouts.current)) {
        shellUnreachable.current = true;
        setShellRun(false);
        const fb = actionsFor(false, source).run;
        if (fb.via === "oneshot") await oneShot(fb.args);
        return;
      }
      setRunNote(msg(e));
    }
    if (live.current) setShellRun(false);
  };
  const run = (source: string = code) => enqueue({ source, authored: false });
  const runAuthored = (source: string) => enqueue({ source, authored: true });
  const stop = () => {
    if (sid) {
      stopThenRelease(sid);
      setSid(null);
      append("\n[stopped]\n");
      return;
    }
    if (shellRun && shell) shell.send("\u0003");
  };
  const answer = (e: FormEvent) => {
    e.preventDefault();
    if (!sid) return;
    const line = typed;
    setTyped("");
    append(`${line}\n`);
    void sendPythonLine(sid, line).catch(() => append("[could not send that line]\n"));
  };

  return {
    shell, shellState, term, sid, starting, shellRun, runNote, typed, setTyped,
    result, attemptCount, checkBusy, checkError, findings, lintBusy, lintError,
    busy: starting || sid !== null || shellRun,
    showOutput: sid !== null || starting || shellRun || term !== "",
    run, runAuthored, check, lint, stop, answer, resetResults,
  };
}
