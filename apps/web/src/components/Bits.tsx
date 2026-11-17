import type { ReactNode } from "react";

export function Bar({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="track h-4" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <div className="h-full bg-blue transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PipEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="chunk px-6 py-5">
      <div className="max-w-[52ch] text-pretty font-medium leading-relaxed">{children}</div>
    </div>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-6xl overflow-x-hidden px-4 pb-24 sm:px-6">{children}</main>;
}

export function Spinner() {
  return <p role="status" className="py-10 text-center font-medium text-[var(--mu)]">Loading…</p>;
}

export function AiBadge() {
  return <span className="pill bg-mint px-2 py-0.5 font-mono text-[11px] text-[var(--okT)]">AI</span>;
}
