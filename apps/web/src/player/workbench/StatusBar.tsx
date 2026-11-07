import type { ReactNode } from "react";
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
};

const DOT = { ready: "var(--ok)", busy: "var(--acT)", error: "var(--bad)" } as const;

export default function StatusBar({ status, cursor, language, theme, onTheme }: Props) {
  return (
    <footer className="flex h-6 flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-t border-[var(--line)] bg-[var(--side)] px-3 text-[11.5px] text-[var(--mu)]">
      <span role="status" className="flex min-w-0 items-center gap-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className="size-2 flex-none rounded-full" style={{ background: DOT[status.tone ?? "ready"] }} />
          <span className="truncate">{status.text}</span>
        </span>
        {status.verdict && <span className="truncate text-[var(--tx)]">{status.verdict}</span>}
      </span>
      <span className="ml-auto flex-none max-sm:hidden">{cursor ? `Ln ${cursor.line}, Col ${cursor.column}` : ""}</span>
      <span className="flex-none max-sm:ml-auto">{language}</span>
      <label className="flex flex-none items-center gap-1">
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
