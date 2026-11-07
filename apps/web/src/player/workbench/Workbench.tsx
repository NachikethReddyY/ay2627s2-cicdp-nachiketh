import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { MAX_FRACTION, MIN_HEIGHT, isToggleKey, type usePanel } from "../terminal/usePanel";
import { WorkbenchContext, type WorkbenchContextValue } from "./context";
import { EDITOR_MIN, LEFT_MAX, LEFT_MIN, UTIL_MAX, UTIL_MIN, clampLayout, resolveTheme, useLayout, type Layout } from "./layout";
import Splitter from "./Splitter";
import StatusBar, { type WorkbenchStatus } from "./StatusBar";
import Toolbar from "./Toolbar";
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
  status: WorkbenchStatus;
  /** Bottom panel open/height state (lq.terminal), shared with whatever renders inside it. */
  panel: ReturnType<typeof usePanel>;
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

  // Keep the bottom panel inside its share of the centre column as the window changes.
  const heightRef = useRef(panel.height);
  heightRef.current = panel.height;
  useEffect(() => {
    if (wide && centerH > 0) panelDispatch({ type: "resize", px: heightRef.current, container: centerH });
  }, [wide, centerH, panelDispatch]);

  // Capture phase, so Ctrl+` toggles the panel even while the editor has focus.
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
  const navBtn = useRef<HTMLButtonElement>(null);
  const utilBtn = useRef<HTMLButtonElement>(null);
  const closeOverlay = () => {
    const back = overlay === "nav" ? navBtn.current : utilBtn.current;
    setOverlay(null);
    back?.focus();
  };

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
    <section aria-label={`${p.bottomTitle ?? "Terminal"} panel`} style={{ height: panel.height }} className="flex min-h-0 flex-none flex-col bg-[var(--tbar)]">
      <div className="flex h-[42px] flex-none items-center border-b border-[var(--line)] px-2.5">
        <h2 className="wb-sec">{p.bottomTitle ?? "Terminal"}</h2>
        <button type="button" className="wb-tb ml-auto" aria-label="Close panel" title="Close panel" onClick={() => panelDispatch({ type: "close" })}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="wb-scroll min-h-0 flex-1">{p.bottom}</div>
    </section>
  );

  const toolbar = (
    <Toolbar
      title={p.title}
      fileName={p.fileName}
      nav={{
        label: wide ? "Toggle navigator" : "Show files",
        pressed: wide ? layout.showLeft : openOverlay === "nav",
        onClick: () => (wide ? dispatch({ type: "toggleLeft" }) : setOverlay((o) => (o === "nav" ? null : "nav"))),
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
        onClick: () => (wide ? dispatch({ type: "toggleUtil" }) : setOverlay((o) => (o === "docs" ? null : "docs"))),
        ref: utilBtn,
      }}
      actions={p.actions}
    />
  );

  const status = (
    <StatusBar status={p.status} cursor={cursor} language={LANG_NAMES[p.language]} theme={layout.theme} onTheme={(theme) => dispatch({ type: "theme", theme })} />
  );

  return (
    <WorkbenchContext value={ctx}>
      <div className={`wb flex flex-col bg-[var(--code)] ${wide ? "h-dvh overflow-hidden" : "min-h-dvh"}`} data-theme={layout.theme} style={{ colorScheme: resolved }}>
        {wide ? (
          <div ref={rowRef} className="flex min-h-0 flex-1">
            {shown.showLeft && (
              <>
                <nav aria-label="Navigator" style={{ width: shown.leftW }} className="wb-scroll flex flex-none flex-col bg-[var(--side)] py-1.5">
                  {p.navigator}
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
                  <div className="flex min-h-0 flex-1 flex-col">{p.editor}</div>
                  {panel.open && (
                    <Splitter
                      orientation="horizontal"
                      label="Resize terminal panel"
                      value={panel.height}
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
            {openOverlay && (
              <Drawer side={openOverlay === "nav" ? "left" : "right"} label={openOverlay === "nav" ? "Files" : "Docs"} onClose={closeOverlay}>
                {openOverlay === "nav" ? p.navigator : p.docs}
              </Drawer>
            )}
          </div>
        )}
        {status}
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

function Drawer({ side, label, onClose, children }: { side: "left" | "right"; label: string; onClose(): void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-40 flex" style={{ justifyContent: side === "left" ? "flex-start" : "flex-end" }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <button type="button" aria-label={`Close ${label.toLowerCase()}`} tabIndex={-1} className="absolute inset-0 cursor-default bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={label} className="relative flex h-full w-[min(85vw,340px)] flex-col bg-[var(--side)] shadow-xl">
        <div className="flex h-12 flex-none items-center border-b border-[var(--line)] px-3">
          <h2 className="text-[13px] font-semibold">{label}</h2>
          <button ref={closeRef} type="button" className="wb-tb ml-auto" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className={`wb-scroll flex-1 py-1.5 ${side === "right" ? "wb-prose px-4" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
