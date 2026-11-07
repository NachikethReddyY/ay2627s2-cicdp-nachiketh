import type { ReactNode } from "react";
import { CircleX, GitBranch, Monitor, Moon, Sun, TriangleAlert } from "lucide-react";
import type { Theme } from "./layout";

export type WorkbenchStatus = {
  text: string;
  verdict?: ReactNode;
  /** Dot colour: ready (green), busy (accent), error (red). Default ready. */
  tone?: "ready" | "busy" | "error";
};

type Props = {
  status: WorkbenchStatus;
  cursor?: { line: number; column: number } | null;
  language: string;
  theme: Theme;
  onTheme(t: Theme): void;
  /** Static sample of the design's branch, problem counts, indent and encoding (not built yet). */
  planned?: boolean;
};

const DOT = { ready: "var(--ok)", busy: "var(--acT)", error: "var(--bad)" } as const;
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export default function StatusBar({ status, cursor, language, theme, onTheme, planned = false }: Props) {
  const ThemeIcon = THEME_ICON[theme];
  return (
    <footer className="flex h-6 flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-t border-[var(--line)] bg-[var(--side)] px-3 text-[11.5px] text-[var(--mu)]">
      {planned && (
        <>
          <span className="wb-mono flex flex-none items-center gap-1.5">
            <GitBranch size={14} strokeWidth={1.9} aria-hidden="true" />
            feat/web-learnslop-rebrand
          </span>
          <span className="flex flex-none items-center gap-3">
            <span className="flex items-center gap-[5px]" title="0 errors">
              <CircleX size={14} strokeWidth={1.9} aria-hidden="true" className="text-[var(--bad)]" />
              <span className="wb-mono">0</span>
              <span className="sr-only">errors</span>
            </span>
            <span className="flex items-center gap-[5px]" title="0 warnings">
              <TriangleAlert size={14} strokeWidth={1.9} aria-hidden="true" className="text-[var(--warn)]" />
              <span className="wb-mono">0</span>
              <span className="sr-only">warnings</span>
            </span>
          </span>
        </>
      )}
      <span role="status" className="flex min-w-0 items-center gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className="wb-dot" style={{ color: DOT[status.tone ?? "ready"] }} />
          <span className="truncate">{status.text}</span>
        </span>
        {status.verdict && <span className="truncate text-[var(--tx)]">{status.verdict}</span>}
      </span>
      <span className="ml-auto flex-none max-sm:hidden">{cursor ? `Ln ${cursor.line}, Col ${cursor.column}` : ""}</span>
      {planned && <span className="flex-none">Spaces: 2</span>}
      {planned && <span className="flex-none">UTF-8</span>}
      <span className="flex-none max-sm:ml-auto">{language}</span>
      <label className="flex flex-none items-center gap-1">
        <ThemeIcon size={13} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">Theme</span>
        <select
          value={theme}
          onChange={(e) => onTheme(e.target.value as Theme)}
          className="h-5 cursor-pointer rounded border-0 bg-transparent px-1 text-[11.5px] text-[var(--mu)] hover:bg-[var(--hov)]"
        >
          <option value="system">System theme</option>
          <option value="light">Light theme</option>
          <option value="dark">Dark theme</option>
        </select>
      </label>
    </footer>
  );
}
