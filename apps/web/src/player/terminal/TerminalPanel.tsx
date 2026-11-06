import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { FOCUS } from "../ui";
import FileTree from "./FileTree";
import type { ShellSocket, ShellState } from "./shellSocket";
import { KEY_STEP, MAX_FRACTION, MIN_HEIGHT, type usePanel } from "./usePanel";

const TerminalView = lazy(() => import("./TerminalView"));

type TerminalPanelProps = {
  shell: ShellSocket;
  panel: ReturnType<typeof usePanel>;
  badge: ReactNode;
  treeKey: number;
  onRefreshTree(): void;
  note?: string;
};

type Line = { text: string; retry?: boolean };

function stateLine(s: ShellState): Line | null {
  switch (s.kind) {
    case "connecting":
      return { text: "Starting your sandbox…" };
    case "reconnecting":
      return { text: "Reconnecting…" };
    case "exited":
      return { text: "[shell ended] Press Enter to start a new one" };
    case "closed":
      if (s.reason === "disabled") return { text: "The sandbox is off on this server" };
      if (s.reason === "signed_out") return { text: "Sign in to use the terminal" };
      if (s.reason === "replaced") return { text: "The terminal is open in another window", retry: true };
      return { text: s.message, retry: true };
    default:
      return null;
  }
}

export default function TerminalPanel({ shell, panel, badge, treeKey, onRefreshTree, note }: TerminalPanelProps) {
  const { state, dispatch } = panel;
  const [shellState, setShellState] = useState<ShellState>(() => shell.state());

  const sectionRef = useRef<HTMLElement>(null);
  const refreshTree = useRef(onRefreshTree);
  refreshTree.current = onRefreshTree;
  useEffect(() => {
    let wasReady = false;
    const track = (s: ShellState) => {
      setShellState(s);
      const ready = s.kind === "open" && s.ready;
      // The sandbox container exists once the shell is ready, so a listing made earlier may have failed.
      if (ready && !wasReady) refreshTree.current();
      wasReady = ready;
    };
    track(shell.state());
    return shell.onState(track);
  }, [shell]);
  useEffect(() => {
    shell.setActive(state.open);
  }, [shell, state.open]);

  // Focus xterm only after an explicit open, not when a restored-open page loads.
  const mountedOpen = useRef(state.open);
  const interacted = useRef(false);
  if (state.open !== mountedOpen.current) interacted.current = true;

  if (!state.everOpened) return null;

  const container = () => sectionRef.current?.parentElement?.clientHeight || window.innerHeight;
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => e.currentTarget.setPointerCapture(e.pointerId);
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const rect = sectionRef.current!.getBoundingClientRect();
    dispatch({ type: "resize", px: rect.bottom - e.clientY, container: container() });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const delta = e.key === "ArrowUp" ? KEY_STEP : -KEY_STEP;
    dispatch({ type: "resize", px: state.height + delta, container: container() });
  };

  const line = stateLine(shellState);
  return (
    <section
      ref={sectionRef}
      aria-label="Terminal panel"
      hidden={!state.open}
      style={{ height: state.height }}
      className="flex flex-none flex-col border-t-[3px] border-ink bg-ink font-mono text-white"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={Math.round(MAX_FRACTION * (sectionRef.current?.parentElement?.clientHeight || window.innerHeight))}
        aria-valuenow={state.height}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className={`h-1.5 flex-none touch-none cursor-row-resize bg-white/20 hover:bg-white/40 ${FOCUS}`}
      />
      <div className="flex flex-none items-center gap-2 border-b-2 border-white/20 px-3 py-1">
        <h3 className="text-sm font-extrabold">Terminal</h3>
        {badge}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onRefreshTree} className={`text-sm ${FOCUS}`}>Refresh</button>
          <button type="button" aria-label="Close terminal" onClick={() => dispatch({ type: "close" })} className={`text-sm font-extrabold ${FOCUS}`}>×</button>
        </div>
      </div>
      {(line || note) && (
        <div role="status" aria-live="polite" className="flex flex-none items-center gap-2 px-3 py-1 text-xs">
          {line && <span>{line.text}</span>}
          {line?.retry && (
            <button type="button" onClick={() => shell.connect()} className={`underline ${FOCUS}`}>Try again</button>
          )}
          {note && <span className="opacity-80">{note}</span>}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="w-[180px] flex-none border-r-2 border-white/20 max-[640px]:hidden">
          <FileTree refreshKey={treeKey} />
        </div>
        <div className="min-w-0 flex-1">
          <Suspense fallback={<p className="p-3 text-sm">Loading terminal…</p>}>
            <TerminalView shell={shell} active={state.open && interacted.current} />
          </Suspense>
        </div>
      </div>
    </section>
  );
}
