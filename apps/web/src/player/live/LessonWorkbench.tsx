import type { GuideChat } from "../workbench/PlannedParts";
import { Suspense, lazy, useRef, useState, type ReactNode } from "react";
import { Check, ListChecks, Play } from "lucide-react";
import { usePostHog } from "@posthog/react";
import { useLessonAnalytics } from "./lessonAnalytics";
import { usePanel } from "../terminal/usePanel";
import DocsPanel from "../workbench/DocsPanel";
import NavigatorSearch from "../workbench/NavigatorSearch";
import { DOCS } from "../workbench/docs";
import SandboxFiles from "../workbench/SandboxFiles";
import Segmented from "../workbench/Segmented";
import Workbench from "../workbench/Workbench";
import { useFloatingWindow } from "../workbench/useFloatingWindow";
import { PreviewResizeHandles } from "../../pages/PreviewResizeHandles";
import WorkbenchEditor from "../workbench/WorkbenchEditor";
import type { WorkbenchStatus } from "../workbench/StatusBar";
import { getWorkspaceFile, putWorkspaceFile, type LintFinding } from "../runPython";
import type { EditorHandle } from "../EditorPane";
import PracticeSolution from "./PracticeSolution";
import PracticeDesignFeedback from "./PracticeDesignFeedback";
import LessonResults from "./LessonResults";
import LessonVideo, { type VideoSource } from "./LessonVideo";
import { monacoLanguage, type PracticeLanguage, type PracticeTest } from "./checkModel";
import { findingPointer } from "./lintModel";
import { actionGuards, lessonFile } from "./lessonWorkbenchModel";
import RunBottom from "./RunBottom";
import { runShellCommand } from "../terminal/runInShell";
import { usePracticeRunner } from "./usePracticeRunner";
import type { Part } from "./types";

const AIGuide = lazy(() => import("../workbench/PlannedParts").then((m) => ({ default: m.AIGuide })));

type PracticePart = Omit<Extract<Part, { kind: "practice" }>, "language"> & { language?: PracticeLanguage; tests?: PracticeTest[] };
type Tab = "instructions" | "video" | "results" | "docs";
const TABS: { id: Tab; label: string }[] = [
  { id: "instructions", label: "Task" },
  { id: "results", label: "Results" },
  { id: "docs", label: "Docs" },
];

export default function LessonWorkbench({ kind, lessonId, title, part, next, media }: { kind: "practice" | "scrim"; lessonId: string; title: string; part: Extract<Part, { kind: "practice" }>; next: ReactNode; media?: VideoSource }) {
  const practice = part as PracticePart;
  const language = monacoLanguage(practice.language);
  const { fileName, languageLabel } = lessonFile(language);
  const posthog = usePostHog();
  const analytics = useLessonAnalytics();
  const [code, setCode] = useState(part.starterCode);
  const [selection, setSelection] = useState<{ startLine: number; endLine: number; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>("instructions");
  const [guideOpen, setGuideOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [terminalFocus, setTerminalFocus] = useState(0);
  const [runError, setRunError] = useState("");
  const launchPending = useRef(false);
  const [guideChat, setGuideChat] = useState<GuideChat>({ messages: [], question: "", sending: false, chatError: "" });
  const guideRequestId = useRef(0);
  const [revealDocs, setRevealDocs] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ text: string } | null>(null);
  const [pendingFinding, setPendingFinding] = useState<{ ruleId: string; line: number; column?: number } | null>(null);
  const win = useFloatingWindow();
  const [extra, setExtra] = useState<{ path: string; code: string } | null>(null);
  const [fileNotice, setFileNotice] = useState("");
  const fileRequest = useRef(0);
  const drafts = useRef(new Map<string, string>());
  const workspace = `workspaces/${lessonId}`;
  const workspacePath = (path: string) => `${workspace}/${path}`;
  const panel = usePanel();
  const { dispatch: panelDispatch } = panel;
  const runRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<EditorHandle>(null);
  const [treeKey, setTreeKey] = useState(0);
  const refreshTree = () => setTreeKey((k) => k + 1);
  const r = usePracticeRunner({
    lessonId, versionId: part.versionId, revision: part.revision, language, code, startShell: true,
    workspace: lessonId,
    openTerminal: () => panelDispatch({ type: "open" }),
    onLint: (findings) => editorRef.current?.showLint(findings),
  });
  const sandboxReady = r.shellState.kind === "open" && r.shellState.ready;
  const openFile = async (path: string) => {
    const request = ++fileRequest.current;
    setFileNotice("");
    if (path === fileName) {
      if (!extra) editorRef.current?.focus();
      setExtra(null);
      return;
    }
    const draft = drafts.current.get(path);
    if (draft !== undefined) {
      setExtra({ path, code: draft });
      return;
    }
    try {
      const file = await getWorkspaceFile(workspacePath(path));
      if (request === fileRequest.current) setExtra({ path, code: file.content });
    } catch {
      if (request === fileRequest.current) setFileNotice("Could not open the workspace file.");
    }
  };
  const saveFile = async () => {
    const path = extra?.path ?? fileName;
    const value = extra?.code ?? code;
    try {
      await putWorkspaceFile(workspacePath(path), value);
      if (drafts.current.get(path) === value) drafts.current.delete(path);
      setFileNotice("Workspace file saved.");
      refreshTree();
    } catch {
      setFileNotice("Could not save the workspace file.");
    }
  };

  const changeCode = (value: string) => {
    r.resetResults();
    setCode(value);
  };

  const show = (t: Tab) => {
    setGuideOpen(false);
    setTab(t);
    setRevealDocs((n) => n + 1);
  };
  const showGuide = () => {
    setGuideOpen(true);
    setRevealDocs((n) => n + 1);
  };
  const can = actionGuards({ busy: launching, checkBusy: r.checkBusy, lintBusy: r.lintBusy, code: extra ? "" : code });
  const run = async () => {
    const socket = r.terminals.find((item) => item.id === r.activeTerminal)?.socket;
    if (!can.run || !socket || launchPending.current) return;
    launchPending.current = true;
    setLaunching(true);
    setRunError("");
    const path = workspacePath(fileName);
    const shellDirectory = "'" + workspace.replaceAll("'", "'\\''") + "'";
    const interpreter = language === "python" ? "python3" : "node";
    try {
      await runShellCommand({
        command: `cd -- "$HOME"/${shellDirectory} && ${interpreter} ${fileName}`,
        panel: { open: () => panelDispatch({ type: "open" }) },
        socket,
        prepare: async () => {
          await putWorkspaceFile(path, code);
          refreshTree();
        },
      });
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Could not run the workspace file.");
    } finally {
      setTerminalFocus((n) => n + 1);
      launchPending.current = false;
      setLaunching(false);
    }
  };
  const check = () => {
    if (!can.check) return;
    posthog?.capture("practice_submission_started", { practice_language: language });
    show("results");
    void r.check().then((completed) => { if (completed) analytics.completed(kind); });
  };
  const lint = () => {
    if (!can.lint) return;
    show("results");
    void r.lint();
  };
  const askAbout = (finding: LintFinding) => {
    setPendingFinding(findingPointer(finding));
    showGuide();
  };

  const navigator = <SandboxFiles workspace={lessonId} title={title} solution={fileName} ready={sandboxReady} revision={treeKey}
    selected={extra?.path ?? fileName} onRefresh={refreshTree} onSelect={(path) => void openFile(path)}
    onSave={() => void saveFile()} fileNotice={fileNotice} />;

  const actions = (
    <>
      <button ref={runRef} type="button" className="wb-tb wb-primary" onClick={() => void run()} disabled={!can.run || !r.shell}>
        <Play size={15} strokeWidth={1.75} aria-hidden="true" />
        Run
      </button>
      <button type="button" className="wb-tb" onClick={check} disabled={!can.check}>
        <Check size={15} strokeWidth={1.75} aria-hidden="true" />
        {r.checkBusy ? "Submitting…" : "Submit"}
      </button>
    </>
  );
  const lintButton = (
      <button type="button" className="wb-tb" onClick={lint} disabled={!can.lint}>
        <ListChecks size={15} strokeWidth={1.75} aria-hidden="true" />
        {r.lintBusy ? "Linting…" : "Lint"}
      </button>
  );
  const instructions = <>
    <p className="whitespace-pre-wrap">{part.instructions}</p>
    {practice.tests?.some((test) => test.visibility === "sample" && test.stdin) && (
      <p className="mt-2 text-xs text-[var(--mu)]">Type input in Terminal. Send EOF with <kbd>Ctrl+D</kbd> on an empty line.</p>
    )}
    <div className="mt-2 flex flex-wrap gap-1">
      {lintButton}
      {media && <button type="button" className="wb-tb" onClick={() => show("video")}>Watch</button>}
    </div>
    <aside className="wb-lesson-next">{next}</aside>
  </>;
  const editorPath = extra?.path ?? fileName;
  const editorLanguage = extra ? extra.path.endsWith(".py") ? "python" : /\.tsx?$/.test(extra.path) ? "typescript" : "javascript" : language;
  const docs = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="wb-lesson-subhead flex min-w-0 flex-none items-center px-2">
        {guideOpen ? (
          <div className="flex w-full items-center justify-between gap-1">
            <span className="px-1 font-semibold">Sloppy</span>
            <button type="button" className="wb-ptab" onClick={() => setGuideOpen(false)}>Back to lesson</button>
          </div>
        ) : (
          <Segmented className="wb-pill wb-lesson-tabs gap-1" role="group" aria-label="Side panel view">
            {TABS.map((t) => (
              <button key={t.id} type="button" className="wb-ptab" aria-pressed={tab === t.id || (t.id === "instructions" && tab === "video")} onClick={() => show(t.id)}>{t.label}</button>
            ))}
          </Segmented>
        )}
      </div>
      <div hidden={guideOpen || tab !== "instructions"} className="wb-prose wb-scroll min-h-0 flex-1 overflow-auto px-3 py-2.5">{instructions}</div>
      {media && !guideOpen && tab === "video" && (
        <div className="wb-scroll min-h-0 flex-1 overflow-auto">
          <LessonVideo
            title={title}
            onExplain={(text) => {
              setPendingPrompt({ text });
              showGuide();
            }}
            sources={[media]}
          />
        </div>
      )}
      <div hidden={guideOpen || tab !== "results"} className="flex min-h-0 flex-1 flex-col">
        <div className="flex justify-end px-3 pt-2">{lintButton}</div>
        <LessonResults result={r.result} tests={practice.tests} checkError={r.checkError} findings={r.findings} lintError={r.lintError} onAsk={askAbout}>
          {!r.checkBusy && r.result?.feedbackReceipt && (
            <PracticeDesignFeedback key={r.result.feedbackReceipt} lessonId={lessonId} code={code} receipt={r.result.feedbackReceipt} />
          )}
          <PracticeSolution lessonId={lessonId} versionId={part.versionId} revision={part.revision} solution={part.solution} attemptCount={r.attemptCount} />
        </LessonResults>
      </div>
      {guideOpen && (
        <div className="flex min-h-0 min-w-0 flex-1">
          <Suspense fallback={null}>
            <AIGuide session={{ chat: guideChat, setChat: setGuideChat, requestId: guideRequestId }} lessonId={lessonId} fileName={editorPath.split("/").at(-1) ?? fileName} filePath={editorPath} projectRoot="." code={extra?.code ?? code} language={editorLanguage} selection={selection} pendingFinding={pendingFinding} onFindingSent={() => setPendingFinding(null)} pendingPrompt={pendingPrompt} onPromptSent={() => setPendingPrompt(null)} />
          </Suspense>
        </div>
      )}
      <div hidden={guideOpen || tab !== "docs"} className="flex min-h-0 flex-1 flex-col">
        <DocsPanel selected={selectedDoc} onSelect={setSelectedDoc} />
      </div>
    </div>
  );

  const bottom = <RunBottom runner={r} terminalActive={panel.state.open} error={runError} focusKey={terminalFocus} />;

  const status: WorkbenchStatus = r.checkBusy ? { text: "Checking…", tone: "busy" }
    : r.lintBusy ? { text: "Linting…", tone: "busy" }
    : launching ? { text: "Starting…", tone: "busy" }
    : { text: extra ? `Editing ${extra.path}` : "Ready" };

  const paletteDocs = DOCS.map((d) => ({ id: d.id, title: d.title, sub: d.src }));
  const paletteCommands = [
    { id: "run", title: "Run", run: () => void run() },
    { id: "check", title: "Submit", run: check },
    { id: "lint", title: "Lint", run: lint },
  ];

  return (
    <Workbench
      title={title}
      fileName={editorPath}
      language={language}
      navigator={navigator}
      navigatorSearch={<NavigatorSearch fileName={editorPath} code={extra?.code ?? code}
        onSelect={(line) => editorRef.current?.focusLine(line)} />}
      editor={<WorkbenchEditor key={editorPath} ref={editorRef} transportRef={runRef} edit={{
        value: extra?.code ?? code, language: editorLanguage,
        onChange: extra ? (value) => {
          drafts.current.set(extra.path, value);
          setExtra({ path: extra.path, code: value });
        } : changeCode,
      }} />}
      bottom={bottom}
      bottomTitle="Terminal"
      lessonLayout
      terminalSessions={{
        items: r.terminals,
        activeId: r.activeTerminal,
        onSelect: r.selectTerminal,
        onNew: r.newTerminal,
        split: r.splitTerminals,
        onToggleSplit: r.toggleSplit,
      }}
      instructions={instructions}
      docs={docs}
      actions={actions}
      paletteFiles={[{ id: fileName, title: fileName, sub: lessonId }]}
      paletteCommands={paletteCommands}
      paletteDocs={paletteDocs}
      onOpenFile={(path) => void openFile(path)}
      onOpenDoc={(id) => {
        setSelectedDoc(id);
        show("docs");
      }}
      status={status}
      languageLabel={languageLabel}
      panel={panel}
      revealDocs={revealDocs}
      floatingWindow={{
        style: win.style,
        resizeHandles: <PreviewResizeHandles onResizeStart={win.onResizeStart} onResizeMove={win.onResizeMove} onResizeEnd={win.onResizeEnd} />,
        onDragStart: win.onDragStart,
        onDragMove: win.onDragMove,
        onDragEnd: win.onDragEnd,
      }}
      guide={{ active: guideOpen, onToggle: () => guideOpen ? setGuideOpen(false) : showGuide(), onOpen: showGuide }}
      onGuideSelection={setSelection}
    />
  );
}
