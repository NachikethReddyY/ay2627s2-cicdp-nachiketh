import type { ReactNode } from "react";
import { CircleX, GitBranch, LoaderCircle, TriangleAlert, WrapText } from "lucide-react";

export type WorkbenchStatus = {
  text: string;
  verdict?: ReactNode;
  /** Dot colour: ready (green), busy (accent), error (red). Default ready. */
  tone?: "ready" | "busy" | "error";
};

type Props = {
  status: WorkbenchStatus;
  errors?: number;
  warnings?: number;
  cursor?: { line: number; column: number } | null;
  language: string;
  onProblems?(): void;
  wordWrap?: boolean;
  onWordWrap?(): void;
  branch?: string;
  /** Static sample of the design's branch, problem counts, indent and encoding (not built yet). */
  planned?: boolean;
};

const DOT = { ready: "var(--ok)", busy: "var(--acT)", error: "var(--bad)" } as const;
export default function StatusBar({ status, errors = 0, warnings = 0, wordWrap = false, cursor, language, onProblems, onWordWrap, branch = "main", planned = false }: Props) {
  return (
    <footer className="flex h-[25px] flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-t border-[var(--line)] bg-[var(--side)] px-3 text-[11.5px] text-[var(--mu)]">
      {planned && (
        <>
          <span className="wb-mono flex flex-none items-center gap-1.5">
            <GitBranch size={14} strokeWidth={1.9} aria-hidden="true" />
            {branch}
          </span>
          <span className="flex flex-none items-center gap-3">
            <button type="button" className="flex items-center gap-[5px] rounded-sm hover:text-[var(--tx)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--acT)]" title="Show problems" aria-label={`Show problems (${errors} errors, ${warnings} warnings)`} onClick={onProblems}>
              <CircleX size={14} strokeWidth={1.9} aria-hidden="true" className="text-[var(--bad)]" />
              <span className="wb-mono">{errors}</span>
              <span className="sr-only">errors. Open Problems</span>
            </button>
            <button type="button" className="flex items-center gap-[5px] rounded-sm hover:text-[var(--tx)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--acT)]" title="Show problems" aria-label={`Show problems (${errors} errors, ${warnings} warnings)`} onClick={onProblems}>
              <TriangleAlert size={14} strokeWidth={1.9} aria-hidden="true" className="text-[var(--warn)]" />
              <span className="wb-mono">{warnings}</span>
              <span className="sr-only">warnings. Open Problems</span>
            </button>
          </span>
        </>
      )}
      <span role="status" className="flex min-w-0 items-center gap-3">
        {status.tone === "busy" && <LoaderCircle size={13} aria-hidden="true" className="flex-none motion-safe:animate-spin" />}
        <span className="truncate">{status.text}</span>
        {status.verdict && <span className="truncate text-[var(--tx)]">{status.verdict}</span>}
      </span>
      <span className="ml-auto flex-none max-sm:hidden">{cursor ? `Ln ${cursor.line}, Col ${cursor.column}` : ""}</span>
      <button type="button" aria-label="Toggle word wrap" title={`Word wrap ${wordWrap ? "on" : "off"}`} aria-pressed={wordWrap} onClick={onWordWrap} className={`flex flex-none items-center gap-1 rounded px-1.5 py-0.5 hover:bg-[var(--hov)] ${wordWrap ? "text-[var(--acT)]" : ""}`}>
        <WrapText size={13} strokeWidth={1.75} aria-hidden="true" /><span>Wrap</span>
      </button>
      {planned && <span className="flex-none">Spaces: 2</span>}
      {planned && <span className="flex-none">UTF-8</span>}
      <span className="flex-none">{language}</span>
      {/* The design's connection dot ends the bar; its colour follows the status. */}
      <span aria-hidden="true" className="wb-dot" style={{ color: DOT[status.tone ?? "ready"] }} />
    </footer>
  );
}
