import { Square, X } from "lucide-react";
import TerminalView from "../terminal/TerminalView";
import { shellLine } from "./lessonWorkbenchModel";
import type { usePracticeRunner } from "./usePracticeRunner";

export function RunOutput({ runner: r, label = "Program output" }: {
  runner: ReturnType<typeof usePracticeRunner>;
  label?: string;
}) {
  return (
    <section aria-label={label} className="flex h-full min-h-0 flex-col bg-[var(--code)]">
      {r.busy && <div className="flex shrink-0 items-center justify-between px-3 py-1 text-xs">
        <span role="status">{r.starting ? "Starting…" : "Running…"}</span>
        {r.sid && <button type="button" onClick={r.stop} className="wb-tb wb-outline h-6 px-2 text-xs">
          <Square size={11} fill="currentColor" aria-hidden="true" /> Stop
        </button>}
      </div>}
      <pre aria-label={label} tabIndex={0} className="wb-mono m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs">{r.term}</pre>
    </section>
  );
}

export default function RunBottom({ runner: r, terminalActive, error, focusKey }: { runner: ReturnType<typeof usePracticeRunner>; terminalActive: boolean; error?: string; focusKey?: number }) {
  const line = shellLine(r.shellState);
  const current = r.terminals.find((item) => item.id === r.activeTerminal);
  const secondary = r.splitTerminals ? r.terminals.find((item) => item.id !== r.activeTerminal) : undefined;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--code)] text-[var(--tx)]">
      {error && <p role="alert" className="shrink-0 px-3 py-1 text-xs text-[var(--bad)]">{error}</p>}
      {r.terminals.length > 1 && (
        <div role="group" aria-label="Terminal sessions" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--line)] px-2">
          {r.terminals.map(({ id, label }, index) => <div key={id} className="flex shrink-0 items-center">
            <button type="button" className="wb-ptab" aria-pressed={id === r.activeTerminal} onClick={() => r.selectTerminal(id)}>{label}</button>
            {index > 0 && <button type="button" className="wb-tb wb-n34" aria-label={`Close ${label}`} onClick={() => r.closeTerminal(id)}><X size={12} aria-hidden="true" /></button>}
          </div>)}
        </div>
      )}
      {line && (current?.socket === r.shell || secondary?.socket === r.shell) && (
        <div role="status" className="flex flex-none items-center gap-2 px-3 py-1 text-xs text-[var(--mu)]">
          <span>{line.text}</span>
          {line.retry && r.shell && <button type="button" onClick={() => r.shell?.connect()} className="underline">Try again</button>}
        </div>
      )}
      <div className={`relative grid min-h-0 flex-1 gap-1 p-1 ${secondary ? "grid-cols-2" : "grid-cols-1"}`}>
        {r.terminals.map((item) => {
          const visible = item === current || item === secondary;
          return <div key={item.id} hidden={!visible} className="relative min-h-0 min-w-0">
            <TerminalView shell={item.socket} active={terminalActive && visible} focusOnActive={item === current} focusKey={focusKey} fitKey={`${r.activeTerminal}:${r.splitTerminals}`} />
          </div>;
        })}
      </div>
    </div>
  );
}
