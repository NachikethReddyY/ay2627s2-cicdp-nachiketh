import { useEffect, useRef, useState, type FormEvent } from "react";
import { createShellSocket, type ShellSocket, type ShellState } from "../terminal/shellSocket";
import { RunInShellError, runInShell } from "../terminal/runInShell";
import { checkPractice, lintPractice, pollPython, putFile, sendPythonLine, startPython, stopPython, type LintFinding, type PyPoll } from "../runPython";
import { practiceActions, shouldFallBack, skipShellWait } from "./practiceActions";
import { lintErrorMessage } from "./lintModel";
import { outputTail } from "./lessonWorkbenchModel";
import type { CheckResponse, PracticeLanguage } from "./checkModel";

const MAX_POLL_FAILURES = 4;
const MAX_OUTPUT = 100_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : "Could not run the code");

type Options = { lessonId: string; language: PracticeLanguage; code: string; openTerminal: () => void };

export function usePracticeRunner({ lessonId, language, code, openTerminal }: Options) {
  const [term, setTerm] = useState("");
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
  const append = (text: string) => setTerm((t) => outputTail(t + text, MAX_OUTPUT));

  const [shell, setShell] = useState<ShellSocket | null>(null);
  useEffect(() => {
    const s = createShellSocket();
    setShell(s);
    return () => {
      s.dispose();
      setShell(null);
    };
  }, []);
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
        shellUnreachable.current = false;
        readyTimeouts.current = 0;
        setRunNote(undefined);
      }
    });
  }, [shell]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (sidRef.current) void stopPython(sidRef.current).catch(() => {});
    };
  }, []);
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
        p = await pollPython(sid, from);
      } catch (e) {
        if (!alive) return;
        if (++failures < MAX_POLL_FAILURES) { timer = setTimeout(poll, 300 * failures); return; }
        append(`\n${msg(e)}\n`);
        void stopPython(sid).catch(() => {});
        setSid(null);
        return;
      }
      if (!alive) return;
      failures = 0;
      from = p.next;
      if (p.output) { stdout.current += p.output; append(p.output); }
      if (!p.done) { timer = setTimeout(poll, 300); return; }
      if (p.error) setTerm((t) => `${t}${t && !t.endsWith("\n") ? "\n" : ""}${p.error}\n`);
      else if (!stdout.current) setTerm((t) => t || "The program ran and printed nothing.");
      setSid(null);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
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
    if (!live.current) { void stopPython(id).catch(() => {}); return; }
    setStarting(false);
    setSid(id);
  };
  const actionsFor = (enabled: boolean) => practiceActions({ language, code, lessonId, sandboxEnabled: enabled });

  useEffect(() => {
    lintSeq.current++;
    setFindings(null);
    setLintError("");
    setLintBusy(false);
  }, [code]);
  const lint = async () => {
    const seq = ++lintSeq.current;
    setLintBusy(true);
    setLintError("");
    try {
      const res = await lintPractice(code, language);
      if (live.current && seq === lintSeq.current) setFindings(res.findings);
    } catch (e) {
      if (live.current && seq === lintSeq.current) { setFindings(null); setLintError(lintErrorMessage(e)); }
    }
    if (live.current && seq === lintSeq.current) setLintBusy(false);
  };
  const check = async () => {
    void lint();
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
        language: language === "python" ? "python" : "javascript",
        code,
        panel: { open: openTerminal },
        socket: shell,
        putFile,
        refreshTree: () => {},
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
    append("\n[stopped]\n");
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
    result, checkBusy, checkError, findings, lintBusy, lintError,
    busy: starting || sid !== null || shellRun,
    showOutput: sid !== null || starting || term !== "",
    run, check, lint, stop, answer,
  };
}
