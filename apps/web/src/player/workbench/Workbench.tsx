import { Columns2, List, Maximize2, Minimize2, Plus, Sparkles, X } from "lucide-react";
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { MAX_FRACTION, MIN_HEIGHT, clampHeight, isToggleKey, type usePanel } from "../terminal/usePanel";
import { WorkbenchContext, type WorkbenchContextValue, type WorkbenchProblem } from "./context";
import { EDITOR_MIN, LEFT_MAX_FRACTION, LEFT_MIN, UTIL_MAX, UTIL_MIN, clampLayout, resolveTheme, useLayout, type Layout } from "./layout";
import CommandPalette, { type PaletteCommand } from "./CommandPalette";
import { paletteKey, type PaletteItem, type PaletteMode } from "./palette";
import { NAV_TABS, Soon, type NavView } from "./Planned";
import Segmented from "./Segmented";
import Splitter from "./Splitter";
import StatusBar, { type WorkbenchStatus } from "./StatusBar";
import Toolbar, { Breadcrumbs, TrafficLights } from "./Toolbar";
import "./workbench.css";

// The planned parts hold sample text, so they load only when showPlanned is on.
const DebugBar = lazy(() => import("./PlannedParts").then((m) => ({ default: m.DebugBar })));
const DebugConsole = lazy(() => import("./PlannedParts").then((m) => ({ default: m.DebugConsole })));
const PlannedNavView = lazy(() => import("./PlannedParts").then((m) => ({ default: m.PlannedNavView })));
const RunStopPill = lazy(() => import("./PlannedParts").then((m) => ({ default: m.RunStopPill })));
const AIGuide = lazy(() => import("./PlannedParts").then((m) => ({ default: m.AIGuide })));

export type WorkbenchLanguage = "javascript" | "typescript" | "python";

type Props = {
  title: string;
  fileName: string;
  /** Folders above the file, root first, for the breadcrumb (Main.dc.html). Without it the breadcrumb shows the lesson title. */
  crumbs?: string[];
  /** The symbol under the caret, last in the breadcrumb. */
  symbol?: string;
  language: WorkbenchLanguage;
  navigator: ReactNode;
  /** Use WorkbenchEditor so the editor follows the workbench theme. */
  editor: ReactNode;
  bottom: ReactNode;
  /** Heading of the bottom panel. Default "Terminal". */
  bottomTitle?: string;
  /** Real shell sessions for the test workbench's terminal tabs. */
  terminalSessions?: {
    items: { id: string; label: string }[];
    activeId: string;
    onSelect(id: string): void;
    onNew(): void;
    split: boolean;
    onToggleSplit(): void;
  };
  /** Shown in the stacked (narrow) layout only; the wide layout keeps the lesson text in the navigator tree. */
  instructions?: ReactNode;
  docs: ReactNode;
  actions: ReactNode;
  /** Palette entries: the open files, the lesson's own commands (Run, Check...) and the docs catalogue. */
  paletteFiles: PaletteItem[];
  paletteCommands: PaletteCommand[];
  paletteDocs: PaletteItem[];
  onOpenFile(id: string): void;
  /** Called after the workbench has switched to the Docs tab. */
  onOpenDoc(id: string): void;
  status: WorkbenchStatus;
  /** Git branch injected by Vite at startup for the local workbench preview. */
  gitBranch?: string;
  /** Status-bar language for the open file; defaults to the lesson language. */
  languageLabel?: string;
  /** Hide Ln/Col (a rendered preview has no caret). */
  noCursor?: boolean;
  /** Bottom panel open/height state (lq.terminal), shared with whatever renders inside it. */
  panel: ReturnType<typeof usePanel>;
  /**
   * Also draw the design's planned parts (AI help, debugger, source control, search, Share,
   * notifications, Back/Forward) as inert "Coming soon" controls. Default false: the practice
   * view must not show dead controls. The /test/editor page turns it on.
   */
  showPlanned?: boolean;
  /** Current editor context for the structured guide on the test workbench. */
  aiContext?: { fileName: string; projectRoot: string; code: string; language: string };
};

const LANG_NAMES: Record<WorkbenchLanguage, string> = { javascript: "JavaScript", typescript: "TypeScript", python: "Python" };
const SPLIT = 12; // .wb-split-v width
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
  const [layout, dispatch] = useLayout();
  const wide = useMedia(WIDE);
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
  // Motion (theme fades, panels fading in) starts after the first paint, so loading does not flash.
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
  const planned = p.showPlanned === true && wide; // the planned parts are drawn only in the wide layout
  const [navView, setNavView] = useState<NavView>("files");
  useEffect(() => setSelection(null), [p.aiContext?.fileName]);
  const [bottomTab, setBottomTab] = useState<"main" | "console">("main");
  const [panelMaximized, setPanelMaximized] = useState(false);
  const view: NavView = planned ? navView : "files";
  const bottomView = planned ? bottomTab : "main";
  const { state: panel, dispatch: panelDispatch } = p.panel;
  useEffect(() => setProblems([]), [p.fileName]);
  useEffect(() => {
    try { window.localStorage.setItem("lq.editor.wordWrap", String(wordWrap)); } catch { /* Settings still work for this session. */ }
  }, [wordWrap]);

  // A theme change eases colours: [data-theming] turns the transitions on for 450 ms, set in the same commit as the
  // new tokens so the change is animated. Hovers and everything else stay instant.
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
  // Measure the panel row and the centre column; clampLayout and the panel height follow them (Review Focus 4).
  useLayoutEffect(() => {
    const row = rowRef.current;
    const center = centerRef.current;
    if (!wide || !row || !center) return;
    const measure = () => {
      setRowW(row.clientWidth);
      setCenterH(center.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    ro.observe(center);
    return () => ro.disconnect();
  }, [wide]);

  // Space the panels share with the editor, without the splitter bars.
  const avail = rowW - (layout.showLeft ? SPLIT : 0) - (layout.showUtil ? SPLIT : 0);
  const panelAvail = Number.isFinite(avail) ? avail : Math.max(0, window.innerWidth - 64 - (layout.showLeft ? SPLIT : 0) - (layout.showUtil ? SPLIT : 0));
  const shown: Layout = clampLayout(layout, panelAvail);
  const leftMax = Math.max(LEFT_MIN, Math.min(Math.floor(panelAvail * LEFT_MAX_FRACTION), panelAvail - (shown.showUtil ? shown.utilW : 0) - EDITOR_MIN));
  const utilMax = Math.max(UTIL_MIN, Math.min(UTIL_MAX, panelAvail - (shown.showLeft ? shown.leftW : 0) - EDITOR_MIN));

  // Fit the bottom panel into the centre column at render, like the widths. Only a user
  // resize writes a new height, so a window that shrinks and grows again gets it back.
  const panelH = wide && centerH > 0 ? clampHeight(panel.height, centerH) : panel.height;

  // Capture phase, so Ctrl+` toggles the panel even while the editor has focus.
  // Consumers must not register their own Ctrl+` listener, or the panel toggles twice.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!isToggleKey(e)) return;
      e.preventDefault();
      if (!e.repeat) panelDispatch({ type: "toggle" });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelDispatch]);

  // Overlays only exist in the narrow layout.
  const openOverlay = wide ? null : overlay;
  const toggleNav = () => (wide ? dispatch({ type: "toggleLeft" }) : setOverlay((o) => (o === "nav" ? null : "nav")));
  const toggleUtil = () => (wide ? dispatch({ type: "toggleUtil" }) : setOverlay((o) => (o === "docs" ? null : "docs")));

  // Command palette. Capture phase on window, so Cmd/Ctrl+P beats Monaco, xterm and the browser's print dialog.
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
    { id: "view.terminal", title: "Toggle terminal panel", hint: "Ctrl+`", run: () => panelDispatch({ type: "toggle" }) },
    { id: "view.docs", title: "Toggle docs panel", run: toggleUtil },
    { id: "theme.light", title: "Color theme: Light", run: () => dispatch({ type: "theme", theme: "light" }) },
    { id: "theme.dark", title: "Color theme: Dark", run: () => dispatch({ type: "theme", theme: "dark" }) },
    { id: "theme.system", title: "Color theme: System", run: () => dispatch({ type: "theme", theme: "system" }) },
  ];
  const navBtn = useRef<HTMLButtonElement>(null);
  const utilBtn = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLButtonElement | null>(null);
  const closeOverlay = () => {
    returnTo.current = overlay === "nav" ? navBtn.current : utilBtn.current;
    setOverlay(null);
  };
  // The toggle is inert until the drawer is gone, so focus it after the commit.
  useEffect(() => {
    if (openOverlay != null || !returnTo.current) return;
    returnTo.current.focus();
    returnTo.current = null;
  }, [openOverlay]);

  const openDocRef = useRef(openDoc);
  openDocRef.current = openDoc;
  const ctx = useMemo<WorkbenchContextValue>(
    () => ({ monacoTheme: resolved === "dark" ? "learnslop-dark" : "learnslop-light", wordWrap, setWordWrap, fileName: p.fileName, setCursor, setSelection, setProblems, openDoc: (id) => openDocRef.current(id) }),
    [resolved, wordWrap, p.fileName],
  );

  const bottomPanel = panel.everOpened && (
    <section aria-label={`${p.bottomTitle ?? "Terminal"} panel`} hidden={!panel.open} style={panelMaximized ? undefined : { height: panelH }} className={`wb-appear flex min-h-0 flex-none flex-col bg-[var(--tbar)] ${panelMaximized ? "absolute inset-0 z-20" : ""}`}>
      <div className="wb-bottom-toolbar flex h-[43px] flex-none items-center border-b border-[var(--line)] px-2.5">
        <h2 className="sr-only">{p.bottomTitle ?? "Terminal"}</h2>
        {planned ? (
          <Segmented className="wb-pill gap-1" role="group" aria-label="Panel view">
            <button type="button" className="wb-ptab" aria-pressed={bottomView === "main"} onClick={() => setBottomTab("main")}>
              {p.bottomTitle ?? "Terminal"}
            </button>
            <button type="button" className="wb-ptab" aria-label="Debug console" title="Debug console" aria-pressed={bottomView === "console"} onClick={() => setBottomTab("console")}><span className="wb-console-full">Debug console</span><span className="wb-console-short" aria-hidden="true">...</span></button>
          </Segmented>
        ) : (
          <span className="wb-pill">
            <span aria-hidden="true" className="wb-ptab" data-on="true">
              {p.bottomTitle ?? "Terminal"}
            </span>
          </span>
        )}
        <span className="wb-pill ml-auto">
          {planned && p.terminalSessions && <>
            <button type="button" className="wb-tb wb-n34" aria-label="New terminal" title={p.terminalSessions.items.length >= 4 ? "Maximum of four terminals" : "New terminal"} disabled={p.terminalSessions.items.length >= 4} onClick={p.terminalSessions.onNew}>
              <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button type="button" className="wb-tb wb-n34" aria-label={p.terminalSessions.split ? "Exit split terminal view" : "Split terminal view"} title={p.terminalSessions.split ? "Exit split view" : p.terminalSessions.items.length < 2 ? "Split view (opens a second terminal)" : "Split view"} onClick={p.terminalSessions.onToggleSplit}>
              <Columns2 size={15} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </>}
          {planned && (
            <button type="button" className="wb-tb wb-n34" aria-label={panelMaximized ? "Restore terminal panel" : "Maximize terminal panel"} title={panelMaximized ? "Restore" : "Maximize"} onClick={() => setPanelMaximized((value) => !value)}>
              {panelMaximized ? <Minimize2 size={15} strokeWidth={1.75} aria-hidden="true" /> : <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="wb-tb wb-n34" aria-label="Close panel" title="Close panel" onClick={() => { setPanelMaximized(false); panelDispatch({ type: "close" }); }}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      </div>
      {/* Keep the real panel mounted (a terminal keeps its session) while the sample console shows. */}
      <div className={`wb-appear wb-scroll min-h-0 flex-1 ${p.terminalSessions ? "overflow-x-hidden" : ""}`} hidden={bottomView === "console"}>
        {p.bottom}
      </div>
      {bottomView === "console" && (
        <div className="wb-appear wb-scroll min-h-0 flex-1">
          <Suspense fallback={null}><DebugConsole /></Suspense>
        </div>
      )}
    </section>
  );

  const toolbar = (split: boolean) => (
    <Toolbar
      split={split}
      title={p.title}
      fileName={p.fileName}
      crumbs={p.crumbs}
      symbol={p.symbol}
      nav={{
        label: wide ? "Toggle navigator" : "Show files",
        pressed: wide ? layout.showLeft : openOverlay === "nav",
        onClick: toggleNav,
        ref: navBtn,
      }}
      terminal={{
        label: "Toggle terminal panel (Ctrl+`)",
        pressed: panel.open,
        onClick: () => panelDispatch({ type: "toggle" }),
      }}
      util={{
        label: wide ? "Toggle docs panel" : "Show docs",
        pressed: wide ? layout.showUtil : openOverlay === "docs",
        onClick: toggleUtil,
        ref: utilBtn,
      }}
      actions={p.actions}
      lights={wide && !shown.showLeft}
      planned={planned}
    />
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
        className={`wb flex flex-col ${wide ? "wb-desk h-dvh overflow-hidden" : "min-h-dvh bg-[var(--code)]"}`}
        data-theme={layout.theme}
        data-resolved={resolved}
        data-ready={ready || undefined}
        style={{ colorScheme: resolved }}
      >
        {/* While a drawer is open, everything behind it is inert: out of the Tab order and the accessibility tree. */}
        <div inert={openOverlay != null} data-palette-open={palette.open || undefined} className={`flex min-h-0 flex-1 flex-col ${wide ? "wb-win" : ""}`}>
          {wide ? (
            <div ref={rowRef} className="flex min-h-0 flex-1">
              {shown.showLeft && (
                <>
                  <nav aria-label="Navigator" style={{ width: shown.leftW }} className="wb-appear wb-side flex min-h-0 flex-none flex-col">
                    <div className="flex flex-none items-center gap-2 px-3 pt-3">
                      <span className="flex h-[34px] items-center">
                        <TrafficLights />
                      </span>
                      {planned && (
                        <>
                          <Segmented className="wb-pill gap-1 shadow-[0_1px_2px_rgba(20,30,70,.1)]" role="group" aria-label="Navigator or AI help">
                            <button type="button" className="wb-tb wb-nb" aria-label="List" title="List" aria-pressed={view !== "ai"} onClick={() => setNavView("files")}>
                              <List size={18} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                            <button type="button" className="wb-tb wb-nb" aria-label="AI help" title="AI help" aria-pressed={view === "ai"} onClick={() => setNavView("ai")}>
                              <Sparkles size={18} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                          </Segmented>
                          <Suspense fallback={null}><RunStopPill /></Suspense>
                        </>
                      )}
                    </div>
                    {planned && view !== "ai" && (
                      <Segmented className="wb-pill wb-navtabs" role="group" aria-label="Navigator view">
                        {NAV_TABS.map((t) => (
                          <button key={t.id} type="button" className="wb-tb relative" aria-label={t.id === "problems" ? `${t.label} (${diagnostics.errors + diagnostics.warnings})` : t.label} title={t.label} aria-pressed={view === t.id} onClick={() => setNavView(t.id)}>
                            <t.icon size={17} strokeWidth={1.7} aria-hidden="true" />
                            {t.id === "problems" && diagnostics.errors + diagnostics.warnings > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-3 rounded-full bg-[var(--bad)] px-1 text-[9px] leading-3 text-white">{diagnostics.errors + diagnostics.warnings}</span>}
                          </button>
                        ))}
                      </Segmented>
                    )}
                    {view === "ai" && p.aiContext ? (
                      <div className="wb-appear flex min-h-0 min-w-0 flex-1 pt-1.5"><Suspense fallback={null}><AIGuide {...p.aiContext} selection={selection} /></Suspense></div>
                    ) : (
                      <div className={`wb-scroll flex-1 pb-1.5 ${planned ? "pt-1.5" : "pt-3"}`}>
                        <div key={view} className="wb-appear">{view === "files" ? p.navigator : <Suspense fallback={null}><PlannedNavView view={view} problems={problems} branch={p.gitBranch} /></Suspense>}</div>
                      </div>
                    )}
                  </nav>
                  <Splitter
                    orientation="vertical"
                    label="Resize navigator"
                    value={shown.leftW}
                    min={LEFT_MIN}
                    max={leftMax}
                    onResize={(px) => dispatch({ type: "resizeLeft", px, container: avail })}
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
                  {panel.open && !panelMaximized && (
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
                {/* The Docs column sits under the toolbar; its header shares the breadcrumb row's band. */}
              {shown.showUtil && (
                <>
                  <Splitter
                    orientation="vertical"
                    label="Resize docs"
                    value={shown.utilW}
                    min={UTIL_MIN}
                    max={utilMax}
                    after
                    onResize={(px) => dispatch({ type: "resizeUtil", px, container: avail })}
                  />
                  <aside aria-label="Docs" style={{ width: shown.utilW }} className="wb-appear flex min-h-0 flex-none flex-col bg-[var(--tbar)]">
                    {p.docs}
                  </aside>
                </>
              )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col">
              {toolbar(false)}
              <main className="flex min-w-0 flex-col bg-[var(--code)]">
                {p.editor}
                {p.instructions && (
                  <section aria-label="Instructions" className="border-t border-[var(--line)] bg-[var(--tbar)] px-4 py-4">
                    <h2 className="mb-2 text-[13px] font-semibold">Instructions</h2>
                    <div className="wb-prose">{p.instructions}</div>
                  </section>
                )}
                {bottomPanel && <div className="border-t border-[var(--line)]">{bottomPanel}</div>}
              </main>
            </div>
          )}
          {status}
        </div>
        <CommandPalette
          open={palette.open}
          initial={palette.mode}
          files={p.paletteFiles}
          commands={[...p.paletteCommands, ...viewCommands]}
          docs={p.paletteDocs}
          onOpenFile={p.onOpenFile}
          onOpenDoc={openDoc}
          onClose={closePalette}
        />
        {openOverlay && (
          <Drawer side={openOverlay === "nav" ? "left" : "right"} label={openOverlay === "nav" ? "Files" : "Docs"} onClose={closeOverlay}>
            {openOverlay === "nav" ? p.navigator : p.docs}
          </Drawer>
        )}
      </div>
    </WorkbenchContext>
  );
}

// Modal drawer for the narrow layout. The caller makes the rest of the workbench inert, so Tab stays
// inside. Focus starts on Close; Escape closes from anywhere; a click on an element marked
// data-drawer-close (a file row, say) closes it after the click is handled.
function Drawer({ side, label, onClose, children }: { side: "left" | "right"; label: string; onClose(): void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A text field with its own Esc (clear the query first) keeps it until it is empty.
      const t = e.target;
      if (t instanceof HTMLInputElement && (t.dataset.ownEsc !== undefined || (t.value !== "" && /^(text|search)$/.test(t.type)))) return;
      if (document.querySelector("dialog[open]")) return; // the command palette owns Esc while it is open
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
      onClick={(e) => (e.target as Element).closest("[data-drawer-close]") && onClose()}
    >
      <button type="button" aria-label={`Close ${label.toLowerCase()}`} tabIndex={-1} className="absolute inset-0 cursor-default bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={label} className="relative flex h-full w-[min(85vw,340px)] flex-col bg-[var(--side)] shadow-xl">
        <div className="flex h-12 flex-none items-center border-b border-[var(--line)] px-3">
          <h2 className={`text-[13px] font-semibold ${side === "right" ? "sr-only" : ""}`}>{label}</h2>
          <button ref={closeRef} type="button" className="wb-tb ml-auto" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className={`flex-1 ${side === "right" ? "wb-prose flex min-h-0 flex-col" : "wb-scroll py-1.5"}`}>{children}</div>
      </div>
    </div>
  );
}
