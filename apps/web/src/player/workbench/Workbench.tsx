import { Columns2, List, Maximize2, Minimize2, Plus, Sparkles, X } from "lucide-react";
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MAX_FRACTION, MIN_HEIGHT, clampHeight, isToggleKey, type usePanel } from "../terminal/usePanel";
import { WorkbenchContext, type WorkbenchContextValue, type WorkbenchProblem } from "./context";
import { EDITOR_MIN, LEFT_MAX_FRACTION, LEFT_MIN, UTIL_MAX, UTIL_MIN, clampLayout, resizeContainerForPanel, resolveTheme, useLayout, type Layout } from "./layout";
import CommandPalette, { type PaletteCommand } from "./CommandPalette";
import { paletteKey, type PaletteItem, type PaletteMode } from "./palette";
import { NAV_TABS, type NavView } from "./Planned";
import Segmented from "./Segmented";
import Splitter from "./Splitter";
import StatusBar, { type WorkbenchStatus } from "./StatusBar";
import Toolbar, { Breadcrumbs, TrafficLights } from "./Toolbar";
import { DrawerCloseContext } from "./TreeRow";
import "./workbench.css";

const DebugBar = lazy(() => import("./PlannedParts").then((m) => ({ default: m.DebugBar })));
const DebugConsole = lazy(() => import("./PlannedParts").then((m) => ({ default: m.DebugConsole })));
const PlannedNavView = lazy(() => import("./PlannedParts").then((m) => ({ default: m.PlannedNavView })));
const RunStopPill = lazy(() => import("./PlannedParts").then((m) => ({ default: m.RunStopPill })));
const AIGuide = lazy(() => import("./PlannedParts").then((m) => ({ default: m.AIGuide })));

export type WorkbenchLanguage = "javascript" | "typescript" | "python";

type Props = {
  title: string;
  fileName: string;
  crumbs?: string[];
  symbol?: string;
  language: WorkbenchLanguage;
  navigator: ReactNode;
  desktopDock?: ReactNode;
  navigatorSearch?: ReactNode;
  editor: ReactNode;
  playerOverlay?: ReactNode;
  bottom?: ReactNode;
  editorFooter?: ReactNode;
  task?: ReactNode;
  bottomTitle?: string;
  runConsole?: { content: ReactNode; view: "main" | "console"; select: (view: "main" | "console") => void };
  lessonLayout?: boolean;
  terminalSessions?: {
    items: { id: string; label: string }[];
    activeId: string;
    onSelect(id: string): void;
    onNew: () => void;
    split: boolean;
    onToggleSplit: () => void;
  };
  instructions?: ReactNode;
  docs?: ReactNode;
  actions: ReactNode;
  trailing?: ReactNode;
  paletteFiles: PaletteItem[];
  paletteCommands: PaletteCommand[];
  paletteDocs: PaletteItem[];
  onOpenFile(id: string): void;
  onOpenDoc(id: string): void;
  status: WorkbenchStatus;
  gitBranch?: string;
  languageLabel?: string;
  noCursor?: boolean;
  panel?: ReturnType<typeof usePanel>;
  showPlanned?: boolean;
  floatingWindow?: {
    style: CSSProperties;
    resizeHandles: ReactNode;
    onDragStart(event: ReactPointerEvent<HTMLElement>): void;
    onDragMove(event: ReactPointerEvent<HTMLElement>): void;
    onDragEnd(): void;
  };
  revealDocs?: number;
  aiContext?: { fileName: string; filePath: string; projectRoot: string; code: string; language: string };
  guide?: { active: boolean; onToggle: () => void; onOpen: () => void };
  onAskGuide?: () => void;
  onGuideSelection?: WorkbenchContextValue["setSelection"];
};

const LANG_NAMES: Record<WorkbenchLanguage, string> = { javascript: "JavaScript", typescript: "TypeScript", python: "Python" };
const SPLIT = 12;
const WIDE = "(min-width: 1024px)";
const DARK = "(prefers-color-scheme: dark)";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

type Overlay = "nav" | "docs" | null;

export default function Workbench(p: Props) {
  const [storedLayout, dispatch] = useLayout();
  const hasDocs = p.docs !== undefined;
  const hasTask = p.task != null;
  const layout = hasDocs ? storedLayout : { ...storedLayout, showUtil: hasTask };
  const wide = useMedia(WIDE);
  const hasPlayerOverlay = p.playerOverlay != null;
  const measurePlayer = wide || hasPlayerOverlay;
  const prefersDark = useMedia(DARK);
  const resolved = resolveTheme(layout.theme, prefersDark);
  const [wordWrap, setWordWrap] = useState(() => {
    try { return window.localStorage.getItem("lq.editor.wordWrap") === "true"; } catch { return false; }
  });
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null);
  const [selection, setSelection] = useState<{ startLine: number; endLine: number; text: string } | null>(null);
  const [problems, setProblems] = useState<WorkbenchProblem[]>([]);
  const diagnostics = { errors: problems.filter((problem) => problem.severity === "error").length, warnings: problems.filter((problem) => problem.severity === "warning").length };
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [ready, setReady] = useState(false);
  const wbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);
  const planned = p.showPlanned === true && wide;
  const [navView, setNavView] = useState<NavView>("files");
  useEffect(() => setSelection(null), [p.aiContext?.filePath]);
  const [bottomTab, setBottomTab] = useState<"main" | "console">("main");
  const [panelMaximized, setPanelMaximized] = useState(false);
  const maximized = panelMaximized && wide;
  const floating = wide ? p.floatingWindow : undefined;
  const windowRef = useRef<HTMLDivElement>(null);
  const [windowActive, setWindowActive] = useState(true);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const dock = target.closest(".editor-dock");
      setWindowActive(Boolean(windowRef.current?.contains(target) || (dock && wbRef.current?.contains(dock))));
    };
    const onBlur = () => setWindowActive(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const lessonTools = p.navigatorSearch !== undefined;
  const view: NavView = planned || lessonTools ? navView : "files";
  const bottomView = p.runConsole?.view ?? (planned ? bottomTab : "main");
  const selectBottom = p.runConsole?.select ?? setBottomTab;
  const panel = p.panel?.state;
  const panelDispatch = p.panel?.dispatch;
  const panelOpen = panel?.open ?? false;
  useEffect(() => setProblems([]), [p.fileName]);
  useEffect(() => {
    try { window.localStorage.setItem("lq.editor.wordWrap", String(wordWrap)); } catch { }
  }, [wordWrap]);

  const firstTheme = useRef(true);
  useLayoutEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    const el = wbRef.current;
    if (!el) return;
    el.setAttribute("data-theming", "");
    const t = setTimeout(() => el.removeAttribute("data-theming"), 450);
    return () => clearTimeout(t);
  }, [resolved]);

  const rowRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const [rowW, setRowW] = useState(Infinity);
  const [centerH, setCenterH] = useState(0);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const center = centerRef.current;
    if (!measurePlayer || !center) return;
    const measure = () => {
      setRowW(row?.clientWidth ?? Infinity);
      setCenterH(center.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (row) ro.observe(row);
    ro.observe(center);
    return () => ro.disconnect();
  }, [measurePlayer, wide]);

  const avail = rowW - (layout.showLeft ? SPLIT : 0) - (layout.showUtil ? SPLIT : 0);
  const panelAvail = Number.isFinite(avail) ? avail : Math.max(0, window.innerWidth - 64 - (layout.showLeft ? SPLIT : 0) - (layout.showUtil ? SPLIT : 0));
  const shown: Layout = clampLayout(layout, panelAvail);
  const leftMax = Math.max(LEFT_MIN, Math.min(Math.floor(panelAvail * LEFT_MAX_FRACTION), panelAvail - (shown.showUtil ? shown.utilW : 0) - EDITOR_MIN));
  const utilMax = Math.max(UTIL_MIN, Math.min(UTIL_MAX, panelAvail - (shown.showLeft ? shown.leftW : 0) - EDITOR_MIN));
  const leftResizeContainer = shown.showUtil ? resizeContainerForPanel(avail, layout.utilW, shown.utilW) : avail;
  const utilResizeContainer = shown.showLeft ? resizeContainerForPanel(avail, layout.leftW, shown.leftW) : avail;

  const panelH = panel && measurePlayer && centerH > 0 ? clampHeight(panel.height, centerH) : panel?.height ?? 0;

  useEffect(() => {
    if (!panelDispatch) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isToggleKey(e)) return;
      e.preventDefault();
      if (!e.repeat) panelDispatch({ type: "toggle" });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelDispatch]);

  const openOverlay = wide ? null : overlay;
  const toggleNav = () => (wide ? dispatch({ type: "toggleLeft" }) : setOverlay((o) => (o === "nav" ? null : "nav")));
  const toggleUtil = () => (wide ? dispatch({ type: "toggleUtil" }) : setOverlay((o) => (o === "docs" ? null : "docs")));

  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({ open: false, mode: "file" });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mode = paletteKey(e);
      if (!mode) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) setPalette({ open: true, mode });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const closePalette = () => setPalette((s) => ({ ...s, open: false }));
  const openDoc = (id: string) => {
    if (wide && !layout.showUtil) dispatch({ type: "toggleUtil" });
    if (!wide) setOverlay("docs");
    p.onOpenDoc(id);
  };
  const viewCommands: PaletteCommand[] = [
    { id: "view.sidebar", title: "Toggle sidebar", run: toggleNav },
    ...(panelDispatch ? [{ id: "view.terminal", title: "Toggle terminal panel", hint: "Ctrl+`", run: () => panelDispatch({ type: "toggle" }) }] : []),
    ...(hasDocs ? [{ id: "view.docs", title: "Toggle docs panel", run: toggleUtil }] : []),
    { id: "theme.light", title: "Color theme: Light", run: () => dispatch({ type: "theme", theme: "light" }) },
    { id: "theme.dark", title: "Color theme: Dark", run: () => dispatch({ type: "theme", theme: "dark" }) },
    { id: "theme.system", title: "Color theme: System", run: () => dispatch({ type: "theme", theme: "system" }) },
  ];
  const navBtn = useRef<HTMLButtonElement>(null);
  const utilBtn = useRef<HTMLButtonElement>(null);
  const termBtn = useRef<HTMLButtonElement>(null);
  const guideBtn = useRef<HTMLButtonElement>(null);
  const panelWasOpen = useRef(panelOpen);
  useEffect(() => {
    if (panelWasOpen.current && !panelOpen) {
      const a = document.activeElement;
      if (!a || a === document.body || a.closest(`[aria-label="${p.bottomTitle ?? "Terminal"} panel"]`)) termBtn.current?.focus();
    }
    panelWasOpen.current = panelOpen;
  }, [panelOpen, p.bottomTitle]);
  const revealRef = useRef({ wide, showUtil: layout.showUtil, dispatch });
  revealRef.current = { wide, showUtil: layout.showUtil, dispatch };
  const lastReveal = useRef(p.revealDocs ?? 0);
  useEffect(() => {
    const n = p.revealDocs ?? 0;
    if (n === lastReveal.current) return;
    lastReveal.current = n;
    const r = revealRef.current;
    if (r.wide) {
      if (!r.showUtil) r.dispatch({ type: "toggleUtil" });
    } else setOverlay("docs");
  }, [p.revealDocs]);
  const afterDrawerClose = useRef<(() => void) | null>(null);
  const closeOverlay = (afterClose?: () => void) => {
    const trigger = overlay === "nav" ? navBtn.current : p.guide?.active ? guideBtn.current : utilBtn.current;
    afterDrawerClose.current = afterClose ?? (() => trigger?.focus());
    setOverlay(null);
  };
  useEffect(() => {
    if (openOverlay != null) return;
    afterDrawerClose.current?.();
    afterDrawerClose.current = null;
  }, [openOverlay]);

  const openDocRef = useRef(openDoc);
  openDocRef.current = openDoc;
  const onGuideSelection = p.onGuideSelection;
  const monacoTheme = resolved === "light" ? "learnslop-light" : p.lessonLayout ? "learnslop-workbench-dark" : "learnslop-dark";
  const ctx = useMemo<WorkbenchContextValue>(
    () => ({ monacoTheme, wordWrap, setWordWrap, fileName: p.fileName, setCursor, setSelection: (value) => { setSelection(value); onGuideSelection?.(value); }, setProblems, openDoc: (id) => openDocRef.current(id) }),
    [monacoTheme, wordWrap, p.fileName, onGuideSelection],
  );

  const bottomPanel = panel?.everOpened && panelDispatch && (
    <section aria-label={`${p.bottomTitle ?? "Terminal"} panel`} hidden={!panelOpen} style={maximized ? undefined : { height: panelH }} className={`wb-appear flex min-h-0 flex-none flex-col bg-[var(--tbar)] ${maximized ? "absolute inset-0 z-20" : ""}`}>
      <div className="wb-bottom-toolbar flex h-[43px] flex-none items-center border-b border-[var(--line)] px-2.5">
        <h2 className="sr-only">{p.bottomTitle ?? "Terminal"}</h2>
        {planned || p.runConsole ? (
          <Segmented className="wb-pill gap-1" role="group" aria-label="Panel view">
            <button type="button" className="wb-ptab" aria-pressed={bottomView === "main"} onClick={() => selectBottom("main")}>
              {p.bottomTitle ?? "Terminal"}
            </button>
            <button type="button" className="wb-ptab" aria-label={p.runConsole ? "Console" : "Debug console"} aria-pressed={bottomView === "console"} onClick={() => selectBottom("console")}><span className="wb-console-full">{p.runConsole ? "Console" : "Debug console"}</span><span className="wb-console-short" aria-hidden="true">{p.runConsole ? "Console" : "..."}</span></button>
          </Segmented>
        ) : (
          <span className="wb-pill">
            <span aria-hidden="true" className="wb-ptab" data-on="true">
              {p.bottomTitle ?? "Terminal"}
            </span>
          </span>
        )}
        <span className="wb-pill ml-auto">
          {p.terminalSessions && (
            <button type="button" className="wb-tb wb-n34" aria-label="New terminal" title={p.terminalSessions.items.length >= 4 ? "Maximum of four terminals" : "New terminal"} disabled={p.terminalSessions.items.length >= 4} onClick={p.terminalSessions.onNew}>
              <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
          {(planned || p.lessonLayout) && p.terminalSessions && (
            <button type="button" className="wb-tb wb-n34" aria-label={p.terminalSessions.split ? "Exit split terminal view" : "Split terminal view"} title={p.terminalSessions.split ? "Exit split view" : p.terminalSessions.items.length < 2 ? "Split view (opens a second terminal)" : "Split view"} onClick={p.terminalSessions.onToggleSplit}>
              <Columns2 size={15} strokeWidth={1.7} aria-hidden="true" />
            </button>
          )}
          {(planned || p.runConsole || p.lessonLayout) && wide && (
            <button type="button" className="wb-tb wb-n34" aria-label={panelMaximized ? "Restore terminal panel" : "Maximize terminal panel"} title={panelMaximized ? "Restore" : "Maximize"} onClick={() => setPanelMaximized((value) => !value)}>
              {panelMaximized ? <Minimize2 size={15} strokeWidth={1.75} aria-hidden="true" /> : <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="wb-tb wb-n34" aria-label="Close panel" title="Close panel" onClick={() => { setPanelMaximized(false); panelDispatch({ type: "close" }); }}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div className={`wb-appear wb-scroll min-h-0 flex-1 ${p.terminalSessions ? "overflow-x-hidden" : ""}`} hidden={bottomView === "console"}>
        {p.bottom}
      </div>
      {bottomView === "console" && (
        <div className="wb-appear wb-scroll min-h-0 flex-1">
          {p.runConsole?.content ?? <Suspense fallback={null}><DebugConsole /></Suspense>}
        </div>
      )}
    </section>
  );

  const toolbar = (split: boolean) => (
    <Toolbar
      split={split}
      compact={p.lessonLayout}
      onRun={() => setBottomTab("main")}
      title={p.title}
      fileName={p.fileName}
      crumbs={p.crumbs}
      symbol={p.symbol}
      nav={{
        label: p.guide ? "File explorer" : wide ? "Toggle navigator" : "Show files",
        pressed: wide ? layout.showLeft : openOverlay === "nav",
        onClick: toggleNav,
        ref: navBtn,
      }}
      navigatorOffset={wide && shown.showLeft ? shown.leftW + SPLIT : undefined}
      guide={p.guide && {
        label: "Sloppy AI",
        pressed: p.guide.active && (wide ? layout.showUtil : openOverlay === "docs"),
        onClick: wide ? (layout.showUtil ? p.guide.onToggle : p.guide.onOpen) : p.guide.onOpen,
        ref: guideBtn,
      }}
      terminal={panelDispatch ? {
        label: "Toggle terminal panel (Ctrl+`)",
        pressed: panelOpen,
        onClick: () => panelDispatch({ type: "toggle" }),
        ref: termBtn,
      } : undefined}
      util={hasDocs ? {
        label: wide ? "Toggle docs panel" : "Show docs",
        pressed: wide ? layout.showUtil : openOverlay === "docs",
        onClick: toggleUtil,
        ref: utilBtn,
      } : undefined}
      actions={p.actions}
      trailing={p.trailing}
      lights={wide && !shown.showLeft}
      planned={planned}
    />
  );

  const problemCount = diagnostics.errors + diagnostics.warnings;
  const navigator = (
    <>
      {(planned || lessonTools) && view !== "ai" && (
        <Segmented className="wb-pill wb-navtabs" role="group" aria-label="Navigator view">
          {NAV_TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className="wb-tb relative" aria-label={id === "problems" ? `${label} (${problemCount})` : label} title={label} aria-pressed={view === id} onClick={() => setNavView(id)}>
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              {id === "problems" && problemCount > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-3 rounded-full bg-[var(--bad)] px-1 text-[9px] leading-3 text-white">{problemCount}</span>}
            </button>
          ))}
        </Segmented>
      )}
      {view === "ai" && p.aiContext ? (
        <div className="wb-appear flex min-h-0 min-w-0 flex-1 pt-1.5"><Suspense fallback={null}><AIGuide {...p.aiContext} selection={selection} /></Suspense></div>
      ) : (
        <div className={`wb-scroll flex-1 pb-1.5 ${planned ? "pt-1.5" : p.lessonLayout ? "" : "pt-3"}`}>
          {lessonTools && <div hidden={view !== "files"}>{p.navigator}</div>}
          {view === "files" && !lessonTools && <div className="wb-appear">{p.navigator}</div>}
          {view !== "files" && (
            <div key={view} className="wb-appear">
              {lessonTools && view === "search" ? p.navigatorSearch
                : lessonTools && view === "git" ? <p className="p-3 text-[var(--mu)]">Source control is unavailable in lesson workspaces.</p>
                : lessonTools && view === "debug" ? <p className="p-3 text-[var(--mu)]">Use Run to execute your code in Terminal. The debugger is unavailable in lesson workspaces.</p>
                : <Suspense fallback={null}><PlannedNavView view={view} problems={problems} branch={p.gitBranch} /></Suspense>}
            </div>
          )}
        </div>
      )}
    </>
  );

  const status = (
    <StatusBar planned={planned} branch={p.gitBranch} status={p.status} errors={diagnostics.errors} warnings={diagnostics.warnings} wordWrap={wordWrap} onWordWrap={() => setWordWrap((value) => !value)} cursor={p.noCursor ? null : cursor} language={p.languageLabel ?? LANG_NAMES[p.language]} onProblems={() => {
      setNavView("problems");
      if (!layout.showLeft) dispatch({ type: "toggleLeft" });
    }} />
  );

  return (
    <WorkbenchContext value={ctx}>
      <div
        ref={wbRef}
        className={`wb flex flex-col ${p.lessonLayout ? "wb-lesson" : ""} ${wide ? "wb-desk h-dvh overflow-hidden" : hasPlayerOverlay ? "relative h-dvh overflow-hidden bg-[var(--code)]" : "min-h-dvh bg-[var(--code)]"}`}
        data-theme={layout.theme}
        data-resolved={resolved}
        data-ready={ready || undefined}
        style={{ colorScheme: resolved }}
      >
        <div
          inert={openOverlay != null}
          ref={windowRef}
          data-palette-open={palette.open || undefined}
          data-inactive={floating && !windowActive ? "" : undefined}
          className={`flex min-h-0 flex-1 flex-col ${wide ? "wb-win" : ""} ${hasPlayerOverlay ? "wb-player-window isolate" : ""} ${floating ? "wb-win-floating" : ""}`}
          style={floating?.style}
          onDragStart={floating && ((event) => event.preventDefault())}
          onPointerDown={floating && ((event) => {
            const target = event.target as HTMLElement;
            if (target.closest("header, [data-window-drag]") && !target.closest("button, select, input, a, [role='tab']")) floating.onDragStart(event);
          })}
          onPointerMove={floating?.onDragMove}
          onPointerUp={floating?.onDragEnd}
          onPointerCancel={floating?.onDragEnd}
        >
          {floating?.resizeHandles}
          {wide ? (
            <div ref={rowRef} className="flex min-h-0 flex-1">
              {shown.showLeft && (
                <>
                  <nav aria-label="Navigator" style={{ width: shown.leftW }} className="wb-appear wb-side flex min-h-0 flex-none flex-col">
                    <div data-window-drag className="wb-sidebar-top flex flex-none items-center gap-2 px-3 pt-3">
                      <span className="flex h-[34px] items-center">
                        <TrafficLights />
                      </span>
                      {planned && (
                        <>
                          <Segmented className="wb-pill gap-1 shadow-[0_1px_2px_rgba(20,30,70,.1)]" role="group" aria-label="Navigator or AI help">
                            <button type="button" className="wb-tb wb-nb" aria-label="List" title="List" aria-pressed={view !== "ai"} onClick={() => setNavView("files")}>
                              <List size={18} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                            <button type="button" className="wb-tb wb-nb" aria-label="AI help" title="AI help" aria-pressed={view === "ai"} onClick={() => p.onAskGuide ? p.onAskGuide() : setNavView("ai")}>
                              <Sparkles size={18} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                          </Segmented>
                          <Suspense fallback={null}><RunStopPill /></Suspense>
                        </>
                      )}
                    </div>
                    {navigator}
                  </nav>
                  <Splitter
                    orientation="vertical"
                    label="Resize navigator"
                    value={shown.leftW}
                    min={LEFT_MIN}
                    max={leftMax}
                    onResize={(px) => dispatch({ type: "resizeLeft", px, container: leftResizeContainer })}
                  />
                </>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                {toolbar(true)}
                <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                <Breadcrumbs title={p.title} fileName={p.fileName} crumbs={p.crumbs} symbol={p.symbol} edge="bottom" />
                <main ref={centerRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--code)]">
                  <div className="relative flex min-h-0 flex-1 flex-col">
                    {p.editor}
                    {planned && navView === "debug" && <Suspense fallback={null}><DebugBar /></Suspense>}
                  </div>
                  {p.editorFooter}
                  {panelOpen && panelDispatch && !panelMaximized && (
                    <Splitter
                      orientation="horizontal"
                      label="Resize terminal panel"
                      value={panelH}
                      min={MIN_HEIGHT}
                      max={Math.max(MIN_HEIGHT, MAX_FRACTION * centerH)}
                      after
                      onResize={(px) => {
                        if (px < MIN_HEIGHT) {
                          setPanelMaximized(false);
                          panelDispatch({ type: "close" });
                        } else {
                          panelDispatch({ type: "resize", px, container: centerH });
                        }
                      }}
                    />
                  )}
                  {bottomPanel}
                </main>
                </div>
              {(hasDocs || hasTask) && shown.showUtil && (
                <>
                  <Splitter
                    orientation="vertical"
                    label={hasTask ? "Resize task" : "Resize docs"}
                    value={shown.utilW}
                    min={UTIL_MIN}
                    max={utilMax}
                    after
                    onResize={(px) => dispatch({ type: "resizeUtil", px, container: utilResizeContainer })}
                  />
                  <aside aria-label={hasTask ? "Prediction task" : p.guide?.active ? "Sloppy AI" : p.lessonLayout ? "Lesson panel" : "Docs"} style={{ width: shown.utilW }} className="wb-appear wb-utility flex min-h-0 min-w-0 flex-none flex-col overflow-hidden bg-[var(--tbar)]">
                    {p.task ?? p.docs}
                  </aside>
                </>
              )}
                </div>
              </div>
            </div>
          ) : (
            <div className={`flex min-w-0 flex-1 flex-col ${hasPlayerOverlay ? "min-h-0" : ""}`}>
              {toolbar(false)}
              <main ref={hasPlayerOverlay ? centerRef : undefined} className={`flex min-w-0 flex-col bg-[var(--code)] ${hasPlayerOverlay ? "min-h-0 flex-1" : ""}`}>
                {p.editor}
                {p.editorFooter}
                {p.task}
                {p.instructions && (
                  <section aria-label="Instructions" className="border-t border-[var(--line)] bg-[var(--tbar)] px-4 py-4">
                    <h2 className="mb-2 text-[13px] font-semibold">Instructions</h2>
                    <div className="wb-prose">{p.instructions}</div>
                  </section>
                )}
                {hasPlayerOverlay ? bottomPanel : bottomPanel && <div className="border-t border-[var(--line)]">{bottomPanel}</div>}
              </main>
            </div>
          )}
          {status}
        </div>
        {hasPlayerOverlay && (
          <div inert={openOverlay != null} className="wb-player-overlay">
            {p.playerOverlay}
          </div>
        )}
        {wide && p.desktopDock}
        <CommandPalette
          open={palette.open}
          initial={palette.mode}
          files={p.paletteFiles}
          commands={[
            ...p.paletteCommands.map((command) => command.id.toLowerCase() === "run" || command.title.toLowerCase() === "run"
              ? { ...command, run: () => { setBottomTab("main"); command.run(); } }
              : command),
            ...viewCommands,
          ]}
          docs={p.paletteDocs}
          onOpenFile={p.onOpenFile}
          onOpenDoc={openDoc}
          onClose={closePalette}
        />
        {openOverlay && (
          <Drawer side={openOverlay === "nav" ? "left" : "right"} label={openOverlay === "nav" ? "Files" : p.guide?.active ? "Sloppy AI" : p.lessonLayout ? "Lesson panel" : "Docs"} onClose={closeOverlay}>
            {openOverlay === "nav" ? lessonTools ? navigator : p.navigator : p.docs}
          </Drawer>
        )}
      </div>
    </WorkbenchContext>
  );
}

function Drawer({ side, label, onClose, children }: { side: "left" | "right"; label: string; onClose(afterClose?: () => void): void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t instanceof HTMLInputElement && (t.dataset.ownEsc !== undefined || (t.value !== "" && /^(text|search)$/.test(t.type)))) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div
      className="fixed inset-0 z-40 flex"
      style={{ justifyContent: side === "left" ? "flex-start" : "flex-end" }}
    >
      <button type="button" aria-label={`Close ${label.toLowerCase()}`} tabIndex={-1} className="absolute inset-0 cursor-default bg-black/30" onClick={() => onClose()} />
      <div role="dialog" aria-modal="true" aria-label={label} className="relative flex h-full w-[min(85vw,340px)] flex-col bg-[var(--side)] shadow-xl">
        <div className="flex h-12 flex-none items-center border-b border-[var(--line)] px-3">
          <h2 className={`text-[13px] font-semibold ${side === "right" ? "sr-only" : ""}`}>{label}</h2>
          <button ref={closeRef} type="button" className="wb-tb ml-auto" aria-label={`Close ${label.toLowerCase()}`} onClick={() => onClose()}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className={`flex-1 ${side === "right" ? "wb-prose flex min-h-0 flex-col" : "wb-scroll flex min-h-0 flex-col py-1.5"}`}><DrawerCloseContext.Provider value={onClose}>{children}</DrawerCloseContext.Provider></div>
      </div>
    </div>
  );
}
