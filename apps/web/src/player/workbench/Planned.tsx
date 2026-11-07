import type { CSSProperties, ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bug,
  ChevronDown,
  Folder,
  GitBranch,
  Play,
  Redo2,
  RotateCcw,
  Search,
  Square,
  StepForward,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

// Planned parts of the workbench, drawn from the design (Main.dc.html) so the test page looks like
// it. None of them has behaviour yet: controls are focusable but aria-disabled and say "Coming soon".
// The workbench shows them only with `showPlanned`; the practice view leaves them out.
// All text here is static sample text from the design, not lesson content.

export const SOON = "Coming soon";

export type NavView = "files" | "search" | "git" | "debug" | "problems" | "ai";

export const NAV_TABS: { id: Exclude<NavView, "ai">; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Source control", icon: GitBranch },
  { id: "debug", label: "Run and debug", icon: Bug },
  { id: "problems", label: "Problems", icon: TriangleAlert },
];

/** A button that is present but does nothing yet. */
export function Soon({ label, className = "wb-tb", style, children }: { label: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <button type="button" className={`${className} wb-soon`} style={style} aria-label={label} aria-disabled="true" title={SOON}>
      {children}
    </button>
  );
}

const icon = (I: LucideIcon, size = 15) => <I size={size} strokeWidth={1.8} aria-hidden="true" />;

/** Run / Stop pill at the end of the navigator head (the design's run controls). */
export function RunStopPill() {
  return (
    <span className="wb-pill ml-auto">
      <Soon label="Run" className="wb-tb wb-nb">
        <Play size={14} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
      </Soon>
      <span aria-hidden="true" className="h-[18px] w-px bg-[var(--line)]" />
      <Soon label="Stop" className="wb-tb wb-nb" style={{ color: "var(--mu)" }}>
        <Square size={13} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
      </Soon>
    </span>
  );
}

/** The floating debug bar over the editor. */
export function DebugBar() {
  return (
    <div className="wb-debugbar" role="toolbar" aria-label="Debug">
      <Soon label="Continue" style={{ color: "var(--acT)" }}>{icon(StepForward)}</Soon>
      <Soon label="Step over">{icon(Redo2)}</Soon>
      <Soon label="Step into">{icon(ArrowDownToLine)}</Soon>
      <Soon label="Step out">{icon(ArrowUpToLine)}</Soon>
      <Soon label="Restart">{icon(RotateCcw)}</Soon>
      <Soon label="Stop debugging" style={{ color: "#d64545" }}>
        <Square size={13} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
      </Soon>
    </div>
  );
}

/** Sample output for the bottom panel's Debug console tab. */
export function DebugConsole() {
  return (
    <div className="wb-mono px-3.5 py-2 text-xs leading-[1.65]">
      <div className="text-[var(--mu)]">Paused on breakpoint · trace-loop.ts:10</div>
      <div>
        <span className="text-[var(--mu)]">&gt;</span> total + i
      </div>
      <div className="text-[var(--nu)]">3</div>
      <div>
        <span className="text-[var(--mu)]">&gt;</span> <span className="wb-caret" />
      </div>
    </div>
  );
}

const IND: CSSProperties = { paddingLeft: 22 };

const Chip = ({ children, mono = false }: { children: ReactNode; mono?: boolean }) => <span className={`wb-chip ${mono ? "wb-mono" : ""}`}>{children}</span>;

const Sec = ({ children, open = false }: { children: ReactNode; open?: boolean }) => (
  <div className="wb-sec">
    {open && <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />}
    {children}
  </div>
);

/** Static navigator views for the tabs that are not built yet. */
export function PlannedNavView({ view }: { view: Exclude<NavView, "files"> }) {
  switch (view) {
    case "search":
      return (
        <>
          <div className="px-2.5 pb-2 pt-1">
            <label htmlFor="wb-soon-search" className="wb-sec" style={{ height: "auto", padding: 0, marginBottom: 6 }}>
              Search
            </label>
            <input id="wb-soon-search" type="text" readOnly aria-disabled="true" title={SOON} placeholder="Find in project" className="wb-field" />
            <div className="mt-2 flex gap-1.5">
              <Chip mono>Aa</Chip>
              <Chip mono>.*</Chip>
              <Chip>files to include</Chip>
            </div>
          </div>
          <p className="px-2.5 py-2.5 text-[var(--mu)]">Type to search across apps, packages and services.</p>
        </>
      );
    case "git":
      return (
        <>
          <Sec>
            Changes<span className="ml-auto">2</span>
          </Sec>
          <div className="wb-tree">
            <span className="wb-dot-sq" style={{ background: "#3178c6" }} />
            trace-loop.ts
            <span className="wb-mono wb-git-m">M</span>
          </div>
          <div className="wb-tree">
            <span className="wb-dot-sq" style={{ background: "#3178c6" }} />
            timeline.test.ts
            <span className="wb-mono ml-auto text-[var(--ok)]">A</span>
          </div>
          <div className="p-2.5">
            <Soon label="Commit" className="wb-tb wb-primary" style={{ height: 30, width: "100%" }}>
              Commit…
            </Soon>
          </div>
          <Sec>Branch</Sec>
          <div className="wb-tree wb-mono">feat/web-learnslop-rebrand</div>
        </>
      );
    case "problems":
      return (
        <>
          <Sec>
            Problems<span className="ml-auto">0</span>
          </Sec>
          <p className="px-3 py-1.5 leading-normal text-[var(--mu)]">No problems have been detected in the workspace.</p>
        </>
      );
    case "debug":
      return (
        <>
          <Sec open>Variables</Sec>
          {[
            ["limit", "4"],
            ["i", "2"],
            ["total", "1"],
          ].map(([k, v]) => (
            <div key={k} className="wb-tree wb-mono" style={IND}>
              <span className="text-[var(--mu)]">{k}</span>
              <span className="ml-auto text-[var(--nu)]">{v}</span>
            </div>
          ))}
          <div className="wb-tree wb-mono" style={IND}>
            <span className="text-[var(--mu)]">frames</span>
            <span className="ml-auto text-[var(--mu)]">Array(2)</span>
          </div>
          <div className="mt-2" />
          <Sec open>Call stack</Sec>
          <div className="wb-tree wb-mono" style={IND}>
            <span className="text-[var(--fn)]">traceLoop</span>
            <span className="ml-auto text-[var(--mu)]">:10</span>
          </div>
          <div className="wb-tree wb-mono" style={IND}>
            <span className="text-[var(--mu)]">(anonymous)</span>
            <span className="ml-auto text-[var(--mu)]">:18</span>
          </div>
          <div className="mt-2" />
          <Sec open>Breakpoints</Sec>
          <div className="wb-tree" style={IND}>
            <span className="size-[9px] flex-none rounded-full bg-[#d64545]" />
            trace-loop.ts
            <span className="wb-mono ml-auto text-[var(--mu)]">10</span>
          </div>
        </>
      );
    case "ai":
      return (
        <>
          <Sec>
            AI help<span className="ml-auto font-medium normal-case tracking-normal">Auto model</span>
          </Sec>
          <div className="flex flex-col gap-3 px-3 pb-2.5 pt-1 leading-normal">
            <div className="flex flex-wrap gap-1.5">
              <Chip mono>trace-loop.ts</Chip>
              <Chip>Lines 9–12</Chip>
            </div>
            <div className="wb-bubble">Why does total end at 6 and not 10?</div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-[var(--mu)]">Read trace-loop.ts</div>
              <div>
                The loop runs for i = 0, 1, 2 and 3, so total adds 0 + 1 + 2 + 3. It stops before i reaches 4 because the check on line 9 is{" "}
                <code className="wb-mono rounded bg-[var(--pane2)] px-[5px] py-px">i &lt; limit</code>.
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Soon label="Explain step by step" className="wb-chip">Explain step by step</Soon>
              <Soon label="Find a bug" className="wb-chip">Find a bug</Soon>
              <Soon label="Write a test" className="wb-chip">Write a test</Soon>
            </div>
            <div className="wb-ask">
              <label htmlFor="wb-soon-ask" className="sr-only">
                Ask AI about this code
              </label>
              <textarea id="wb-soon-ask" rows={2} readOnly aria-disabled="true" title={SOON} placeholder="Ask about this code" />
              <Soon label="Send" className="wb-send">
                <ArrowUp size={15} strokeWidth={2} aria-hidden="true" />
              </Soon>
            </div>
          </div>
        </>
      );
  }
}
