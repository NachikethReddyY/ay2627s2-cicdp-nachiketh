import { Square } from "lucide-react";
import TerminalView from "../terminal/TerminalView";
import { shellLine } from "./lessonWorkbenchModel";
import type { usePracticeRunner } from "./usePracticeRunner";

export function RunOutput({ runner: r, label = "Output" }: { runner: ReturnType<typeof usePracticeRunner>; label?: string }) {
  return (
    <section aria-label={label} className="flex max-h-[45%] min-h-24 flex-none flex-col border-b border-[var(--line)]">
      <div className="flex flex-none items-center gap-2 px-3 py-1">
        <h3 className="text-xs font-semibold">{label}</h3>
        {(r.sid || r.shellRun) && (
          <button type="button" onClick={r.stop} className="wb-tb wb-outline ml-auto h-6 px-2 text-xs">
            <Square size={11} fill="currentColor" aria-hidden="true" /> Stop
          </button>
        )}
      </div>
      <pre aria-label={label} tabIndex={0} className="wb-mono m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 pb-2 text-xs">{r.term}</pre>
      {r.sid && (
        <form onSubmit={r.answer} className="flex flex-none items-center gap-2 border-t border-[var(--line)] px-3 py-1.5 text-xs">
          <span aria-hidden="true" className="font-semibold">{">"}</span>
          <input
            autoFocus
            value={r.typed}
            onChange={(e) => r.setTyped(e.target.value)}
            aria-label="Type your answer and press Enter"
            autoComplete="off"
            spellCheck={false}
            placeholder="type your answer, then Enter"
            className="min-w-0 flex-1 border-0 bg-transparent text-[var(--tx)] outline-none placeholder:text-[var(--mu)]"
          />
        </form>
      )}
    </section>
  );
}

export default function RunBottom({ runner: r, terminalActive }: { runner: ReturnType<typeof usePracticeRunner>; terminalActive: boolean }) {
  const line = shellLine(r.shellState);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--code)] text-[var(--tx)]">
      {r.showOutput && <RunOutput runner={r} />}
      {(line || r.runNote) && (
        <div role="status" aria-live="polite" className="flex flex-none items-center gap-2 px-3 py-1 font-sans text-xs text-[var(--mu)]">
          {line && <span>{line.text}</span>}
          {line?.retry && r.shell && <button type="button" onClick={() => r.shell?.connect()} className="underline">Try again</button>}
          {r.runNote && <span>{r.runNote}</span>}
        </div>
      )}
      <div className="relative min-h-0 flex-1 p-1">
        {r.shell && <TerminalView shell={r.shell} active={terminalActive} />}
      </div>
    </div>
  );
}
