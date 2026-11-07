import { Columns2, List, Plus, Search, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { MAX_FRACTION, MIN_HEIGHT, clampHeight, isToggleKey, type usePanel } from "../terminal/usePanel";
import { WorkbenchContext, type WorkbenchContextValue } from "./context";
import { EDITOR_MIN, LEFT_MAX, LEFT_MIN, UTIL_MAX, UTIL_MIN, clampLayout, resolveTheme, useLayout, type Layout } from "./layout";
import CommandPalette, { type PaletteCommand } from "./CommandPalette";
import { paletteKey, type PaletteItem, type PaletteMode } from "./palette";
import { DebugBar, DebugConsole, NAV_TABS, PlannedNavView, RunStopPill, Soon, type NavView } from "./Planned";
import Splitter from "./Splitter";
import StatusBar, { type WorkbenchStatus } from "./StatusBar";
import Toolbar, { TrafficLights } from "./Toolbar";
import "./workbench.css";

export type WorkbenchLanguage = "javascript" | "typescript" | "python";

type Props = {
  title: string;
  fileName: string;
  language: WorkbenchLanguage;
  navigator: ReactNode;
  /** Use WorkbenchEditor so the editor follows the workbench theme. */
  editor: ReactNode;
  bottom: ReactNode;
  /** Heading of the bottom panel. Default "Terminal". */
  bottomTitle?: string;
  instructions: ReactNode;
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
  /** Bottom panel open/height state (lq.terminal), shared with whatever renders inside it. */
  panel: ReturnType<typeof usePanel>;
  /**
   * Also draw the design's planned parts (AI help, debugger, source control, search, Share,
   * notifications, Back/Forward) as inert "Coming soon" controls. Default false: the practice
   * view must not show dead controls. The /test/editor page turns it on.
   */
  showPlanned?: boolean;
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
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const planned = p.showPlanned === true && wide; // the planned parts are drawn only in the wide layout
  const [navView, setNavView] = useState<NavView>("files");
  const [bottomTab, setBottomTab] = useState<"main" | "console">("main");
  const view: NavView = planned ? navView : "files";
  const bottomView = planned ? bottomTab : "main";
  const { state: panel, dispatch: panelDispatch } = p.panel;

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
  const shown: Layout = clampLayout(layout, avail);
  const leftMax = Math.max(LEFT_MIN, Math.min(LEFT_MAX, avail - (shown.showUtil ? shown.utilW : 0) - EDITOR_MIN));
  const utilMax = Math.max(UTIL_MIN, Math.min(UTIL_MAX, avail - (shown.showLeft ? shown.leftW : 0) - EDITOR_MIN));

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
    dispatch({ type: "utilTab", tab: "docs" });
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
  const mac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
  const searchKey = mac ? "⌘P" : "Ctrl+P";
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

  const ctx = useMemo<WorkbenchContextValue>(
    () => ({ monacoTheme: resolved === "dark" ? "learnslop-dark" : "learnslop-light", setCursor }),
    [resolved],
  );

  const tabs = (
    <UtilTabs
      tab={layout.utilTab}
      onTab={(tab) => dispatch({ type: "utilTab", tab })}
      instructions={p.instructions}
      docs={p.docs}
    />
  );

  const bottomPanel = panel.open && (
    <section aria-label={`${p.bottomTitle ?? "Terminal"} panel`} style={{ height: panelH }} className="flex min-h-0 flex-none flex-col bg-[var(--tbar)]">
      <div className="flex h-[42px] flex-none items-center border-b border-[var(--line)] px-2.5">
        <h2 className="sr-only">{p.bottomTitle ?? "Terminal"}</h2>
        {planned ? (
          <span className="wb-pill" style={{ gap: 4 }} role="group" aria-label="Panel view">
            <button type="button" className="wb-ptab" aria-pressed={bottomView === "main"} onClick={() => setBottomTab("main")}>
              {p.bottomTitle ?? "Terminal"}
            </button>
            <button type="button" className="wb-ptab" aria-pressed={bottomView === "console"} onClick={() => setBottomTab("console")}>
              Debug console
            </button>
          </span>
        ) : (
          <span className="wb-pill">
            <span aria-hidden="true" className="wb-ptab" data-on="true">
              {p.bottomTitle ?? "Terminal"}
            </span>
          </span>
        )}
        <span className="wb-pill ml-auto">
          {planned && (
            <>
              <Soon label="New terminal">
                <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
              </Soon>
              <Soon label="Split terminal">
                <Columns2 size={15} strokeWidth={1.7} aria-hidden="true" />
              </Soon>
            </>
          )}
          <button type="button" className="wb-tb" aria-label="Close panel" title="Close panel" onClick={() => panelDispatch({ type: "close" })}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      </div>
      {/* Keep the real panel mounted (a terminal keeps its session) while the sample console shows. */}
      <div className="wb-scroll min-h-0 flex-1" hidden={bottomView === "console"}>
        {p.bottom}
      </div>
      {bottomView === "console" && (
        <div className="wb-scroll min-h-0 flex-1">
          <DebugConsole />
        </div>
      )}
    </section>
  );

  const toolbar = (
    <Toolbar
      title={p.title}
      fileName={p.fileName}
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
        label: wide ? "Toggle instructions and docs" : "Show docs",
        pressed: wide ? layout.showUtil : openOverlay === "docs",
        onClick: toggleUtil,
        ref: utilBtn,
      }}
      tools={
        <button type="button" className="wb-tb flex-none" aria-label="Search and commands" title={`Search and commands (${searchKey})`} onClick={() => setPalette({ open: true, mode: "file" })}>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      }
      actions={p.actions}
      lights={wide && !shown.showLeft}
      planned={planned}
    />
  );

  const status = (
    <StatusBar planned={planned} status={p.status} cursor={cursor} language={LANG_NAMES[p.language]} theme={layout.theme} onTheme={(theme) => dispatch({ type: "theme", theme })} />
  );

  return (
    <WorkbenchContext value={ctx}>
      <div
        className={`wb flex flex-col ${wide ? "wb-desk h-dvh overflow-hidden" : "min-h-dvh bg-[var(--code)]"}`}
        data-theme={layout.theme}
        data-resolved={resolved}
        style={{ colorScheme: resolved }}
      >
        {/* While a drawer is open, everything behind it is inert: out of the Tab order and the accessibility tree. */}
        <div inert={openOverlay != null} className={`flex min-h-0 flex-1 flex-col ${wide ? "wb-win" : ""}`}>
          {wide ? (
            <div ref={rowRef} className="flex min-h-0 flex-1">
              {shown.showLeft && (
                <>
                  <nav aria-label="Navigator" style={{ width: shown.leftW }} className="wb-side flex min-h-0 flex-none flex-col">
                    <div className="flex flex-none items-center gap-2 px-3 pt-3">
                      <span className="flex h-8 items-center">
                        <TrafficLights />
                      </span>
                      {planned && (
                        <>
                          <span className="wb-pill" style={{ gap: 4 }} role="group" aria-label="Navigator or AI help">
                            <button type="button" className="wb-tb wb-nb" aria-label="List" title="List" aria-pressed={view !== "ai"} onClick={() => setNavView("files")}>
                              <List size={18} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                            <button type="button" className="wb-tb wb-nb" aria-label="AI help" title="AI help" aria-pressed={view === "ai"} onClick={() => setNavView("ai")}>
                              <Sparkles size={18} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                          </span>
                          <RunStopPill />
                        </>
                      )}
                    </div>
                    {planned && view !== "ai" && (
                      <div className="wb-pill wb-navtabs" role="group" aria-label="Navigator view">
                        {NAV_TABS.map((t) => (
                          <button key={t.id} type="button" className="wb-tb" aria-label={t.label} title={t.label} aria-pressed={view === t.id} onClick={() => setNavView(t.id)}>
                            <t.icon size={17} strokeWidth={1.7} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={`wb-scroll flex-1 pb-1.5 ${planned ? "pt-1.5" : "pt-3"}`}>
                      {view === "files" ? p.navigator : <PlannedNavView view={view} />}
                    </div>
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
                {toolbar}
                <div className="flex min-h-0 flex-1">
                  <main ref={centerRef} className="flex min-w-0 flex-1 flex-col bg-[var(--code)]">
                    <div className="relative flex min-h-0 flex-1 flex-col">
                      {p.editor}
                      {planned && <DebugBar />}
                    </div>
                    {panel.open && (
                      <Splitter
                        orientation="horizontal"
                        label="Resize terminal panel"
                        value={panelH}
                        min={MIN_HEIGHT}
                        max={Math.max(MIN_HEIGHT, MAX_FRACTION * centerH)}
                        after
                        onResize={(px) => panelDispatch({ type: "resize", px, container: centerH })}
                      />
                    )}
                    {bottomPanel}
                  </main>
                  {shown.showUtil && (
                    <>
                      <Splitter
                        orientation="vertical"
                        label="Resize instructions and docs"
                        value={shown.utilW}
                        min={UTIL_MIN}
                        max={utilMax}
                        after
                        onResize={(px) => dispatch({ type: "resizeUtil", px, container: avail })}
                      />
                      <aside aria-label="Instructions and docs" style={{ width: shown.utilW }} className="flex min-h-0 flex-none flex-col bg-[var(--tbar)]">
                        {tabs}
                      </aside>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col">
              {toolbar}
              <main className="flex min-w-0 flex-col bg-[var(--code)]">
                {p.editor}
                <section aria-label="Instructions" className="border-t border-[var(--line)] bg-[var(--tbar)] px-4 py-4">
                  <h2 className="mb-2 text-[13px] font-semibold">Instructions</h2>
                  <div className="wb-prose">{p.instructions}</div>
                </section>
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

function UtilTabs({ tab, onTab, instructions, docs }: { tab: Layout["utilTab"]; onTab(t: Layout["utilTab"]): void; instructions: ReactNode; docs: ReactNode }) {
  const ids = ["instructions", "docs"] as const;
  const names = { instructions: "Instructions", docs: "Docs" };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = ids[(ids.indexOf(tab) + 1) % ids.length];
    onTab(next);
    document.getElementById(`wb-tab-${next}`)?.focus();
  };
  return (
    <>
      <div role="tablist" aria-label="Utility area" onKeyDown={onKeyDown} className="flex h-[51px] flex-none items-end gap-4 border-b border-[var(--line)] px-3">
        {ids.map((id) => (
          <button
            key={id}
            id={`wb-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`wb-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className="wb-tab"
            onClick={() => onTab(id)}
          >
            {names[id]}
          </button>
        ))}
      </div>
      <div id={`wb-panel-${tab}`} role="tabpanel" aria-labelledby={`wb-tab-${tab}`} className="wb-scroll wb-prose flex-1 px-4 pb-5 pt-4">
        {tab === "instructions" ? instructions : docs}
      </div>
    </>
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
          <h2 className="text-[13px] font-semibold">{label}</h2>
          <button ref={closeRef} type="button" className="wb-tb ml-auto" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
            <X size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className={`wb-scroll flex-1 py-1.5 ${side === "right" ? "wb-prose px-4" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
