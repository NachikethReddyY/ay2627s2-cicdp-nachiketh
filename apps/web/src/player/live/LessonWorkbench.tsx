import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { usePanel } from "../terminal/usePanel";
import DocsPanel from "../workbench/DocsPanel";
import { DOCS } from "../workbench/docs";
import FileTreeView from "../workbench/FileTreeView";
import Segmented from "../workbench/Segmented";
import Workbench from "../workbench/Workbench";
import { useFloatingWindow } from "../workbench/useFloatingWindow";
import { PreviewResizeHandles } from "../../pages/PreviewResizeHandles";
import EditorDock, { type EditorDockItem } from "../../pages/EditorDock";
import { EditorAppIcon, NotepadAppIcon } from "../../pages/DockAppIcons";
import Notepad from "../../pages/Notepad";
import WorkbenchEditor from "../workbench/WorkbenchEditor";
import type { WorkbenchStatus } from "../workbench/StatusBar";
import type { LintFinding } from "../runPython";
import LessonResults from "./LessonResults";
import LessonVideo from "./LessonVideo";
import { monacoLanguage, type PracticeLanguage, type PracticeTest } from "./checkModel";
import { findingPointer } from "./lintModel";
import { actionGuards, lessonFile } from "./lessonWorkbenchModel";
import RunBottom from "./RunBottom";
import { usePracticeRunner } from "./usePracticeRunner";
import type { Part } from "./types";

const AIGuide = lazy(() => import("../workbench/PlannedParts").then((m) => ({ default: m.AIGuide })));

type PracticePart = Omit<Extract<Part, { kind: "practice" }>, "language"> & { language?: PracticeLanguage; tests?: PracticeTest[] };
type Tab = "instructions" | "video" | "results" | "sloppy" | "docs";
const TABS: { id: Tab; label: string }[] = [
  { id: "instructions", label: "Task" },
  { id: "video", label: "Watch" },
  { id: "results", label: "Results" },
  { id: "sloppy", label: "Sloppy" },
  { id: "docs", label: "Docs" },
];
const WATCHLESS_TABS = TABS.filter((t) => t.id !== "video");
const ROOT = "Lesson";

const BUSY = "Running…";

export default function LessonWorkbench({ lessonId, title, part, next, video = true }: { lessonId: string; title: string; part: Extract<Part, { kind: "practice" }>; next: ReactNode; video?: boolean }) {
  const practice = part as PracticePart;
  const language = monacoLanguage(practice.language);
  const { fileName, languageLabel } = lessonFile(language);
  const [code, setCode] = useState(part.starterCode);
  const [tab, setTab] = useState<Tab>("instructions");
  const [sloppyMounted, setSloppyMounted] = useState(false);
  const [revealDocs, setRevealDocs] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ text: string } | null>(null);
  const [pendingFinding, setPendingFinding] = useState<{ ruleId: string; line: number; column?: number } | null>(null);
  const win = useFloatingWindow();
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.querySelector(".wb")), []);
  const panel = usePanel();
  const { dispatch: panelDispatch } = panel;
  const runRef = useRef<HTMLButtonElement>(null);
  const r = usePracticeRunner({ lessonId, language, code, openTerminal: () => panelDispatch({ type: "open" }) });

  const mountedOpen = useRef(panel.state.open);
  const [interacted, setInteracted] = useState(false);
  useEffect(() => {
    if (panel.state.open !== mountedOpen.current) setInteracted(true);
  }, [panel.state.open]);

  const show = (t: Tab) => {
    setTab(t);
    setRevealDocs((n) => n + 1);
    if (t === "sloppy") setSloppyMounted(true);
  };
  const can = actionGuards({ busy: r.busy, checkBusy: r.checkBusy, lintBusy: r.lintBusy, code });
  const run = () => {
    if (!can.run) return;
    panelDispatch({ type: "open" });
    void r.run();
  };
  const check = () => {
    if (!can.check) return;
    show("results");
    void r.check();
  };
  const lint = () => {
    if (!can.lint) return;
    show("results");
    void r.lint();
  };
  const askAbout = (finding: LintFinding) => {
    setPendingFinding(findingPointer(finding));
    show("sloppy");
  };

  const tree = useMemo(() => [{ name: ROOT, open: true, children: [{ name: fileName }] }], [fileName]);
  const open = useMemo(() => new Set([ROOT]), []);
  const navigator = (
    <div className="min-w-0">
      <FileTreeView label="Lesson files" nodes={tree} open={open} selected={`${ROOT}/${fileName}`} onToggle={() => {}} onSelect={() => {}} />
    </div>
  );

  const actions = (
    <button ref={runRef} type="button" className="wb-tb wb-primary" onClick={check} disabled={!can.check}>
      <Check size={15} strokeWidth={1.75} aria-hidden="true" />
      {r.checkBusy ? "Submitting…" : "Submit"}
    </button>
  );
  const trailing = <span className="lq-next">{next}</span>;

  const instructions = <p className="whitespace-pre-wrap">{part.instructions}</p>;
  const docs = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="wb-scroll flex h-[43px] flex-none items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-[var(--line)] px-2.5">
        <Segmented className="wb-pill gap-1" role="group" aria-label="Side panel view">
          {(video ? TABS : WATCHLESS_TABS).map((t) => (
            <button key={t.id} type="button" className="wb-ptab" aria-pressed={tab === t.id} onClick={() => show(t.id)}>{t.label}</button>
          ))}
        </Segmented>
      </div>
      <div hidden={tab !== "instructions"} className="wb-prose wb-scroll min-h-0 flex-1 overflow-auto px-3 py-2.5">{instructions}</div>
      {video && (
        <div hidden={tab !== "video"} className="wb-scroll min-h-0 flex-1 overflow-auto">
          <LessonVideo
            title={title}
            captionsSrc={`/video/${lessonId}.vtt`}
            chaptersSrc={`/video/${lessonId}.chapters.vtt`}
            onExplain={(text) => {
              setPendingPrompt({ text });
              show("sloppy");
            }}
            sources={[
              { src: `/video/${lessonId}.mp4`, type: "video/mp4" },
              { src: `/audio/${lessonId}.mp3`, type: "audio/mpeg" },
            ]}
          />
        </div>
      )}
      <div hidden={tab !== "results"} className="flex min-h-0 flex-1 flex-col">
        <LessonResults result={r.result} tests={practice.tests} checkError={r.checkError} findings={r.findings} lintError={r.lintError} onAsk={askAbout} />
      </div>
      {sloppyMounted && (
        <div hidden={tab !== "sloppy"} className="flex min-h-0 min-w-0 flex-1">
          <Suspense fallback={null}>
            <AIGuide fileName={fileName} filePath={fileName} projectRoot="." code={code} language={language} selection={null} pendingFinding={pendingFinding} onFindingSent={() => setPendingFinding(null)} pendingPrompt={pendingPrompt} onPromptSent={() => setPendingPrompt(null)} />
          </Suspense>
        </div>
      )}
      <div hidden={tab !== "docs"} className="flex min-h-0 flex-1 flex-col">
        <DocsPanel selected={selectedDoc} onSelect={setSelectedDoc} />
      </div>
    </div>
  );

  const bottom = <RunBottom runner={r} terminalActive={panel.state.open && interacted} />;

  const status: WorkbenchStatus = r.checkBusy ? { text: "Checking…", tone: "busy" }
    : r.lintBusy ? { text: "Linting…", tone: "busy" }
    : r.busy ? { text: BUSY, tone: "busy" }
    : r.runNote ? { text: r.runNote, tone: "error" }
    : { text: "Ready" };

  const paletteDocs = DOCS.map((d) => ({ id: d.id, title: d.title, sub: d.src }));
  const paletteCommands = [
    { id: "run", title: "Run", run },
    { id: "check", title: "Submit", run: check },
    { id: "lint", title: "Lint", run: lint },
  ];

  const dockItems: EditorDockItem[] = [
    { id: "editor", label: "Code editor", art: <EditorAppIcon />, pressed: !notepadOpen, onSelect: () => setNotepadOpen(false) },
    { id: "notepad", label: "Notepad", art: <NotepadAppIcon />, pressed: notepadOpen, onSelect: () => setNotepadOpen((o) => !o) },
  ];

  return (
    <>
    <Workbench
      title={title}
      fileName={fileName}
      language={language}
      navigator={navigator}
      editor={<WorkbenchEditor key={fileName} transportRef={runRef} edit={{ value: code, language, onChange: setCode }} />}
      bottom={bottom}
      bottomTitle="Terminal"
      instructions={instructions}
      docs={docs}
      actions={actions}
      trailing={trailing}
      paletteFiles={[{ id: fileName, title: fileName, sub: ROOT }]}
      paletteCommands={paletteCommands}
      paletteDocs={paletteDocs}
      onOpenFile={() => {}}
      onOpenDoc={(id) => {
        setSelectedDoc(id);
        show("docs");
      }}
      status={status}
      languageLabel={languageLabel}
      panel={panel}
      revealDocs={revealDocs}
      showPlanned
      floatingWindow={{
        style: win.style,
        resizeHandles: <PreviewResizeHandles onResizeStart={win.onResizeStart} onResizeMove={win.onResizeMove} onResizeEnd={win.onResizeEnd} />,
        onDragStart: win.onDragStart,
        onDragMove: win.onDragMove,
        onDragEnd: win.onDragEnd,
      }}
      aiContext={{ fileName, filePath: fileName, projectRoot: ".", code, language }}
    />
    {notepadOpen && host && createPortal(<Notepad onClose={() => setNotepadOpen(false)} instructions={part.instructions} />, host)}
    <EditorDock items={dockItems} />
    </>
  );
}
