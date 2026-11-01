import type { ReactNode } from "react";

export function Bar({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="track h-4" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <div className="h-full bg-green" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PipEmpty({ children, img = "pip-think" }: { children: ReactNode; img?: string }) {
  return (
    <div className="chunk flex items-center gap-4 bg-white p-5">
      <img src={`/img/${img}.png`} alt="" className="w-20 shrink-0" />
      <div className="font-bold">{children}</div>
    </div>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-6xl overflow-x-hidden px-4 pb-24 sm:px-6">{children}</main>;
}

export function Spinner() {
  return <p role="status" className="py-10 text-center font-extrabold">Loading…</p>;
}

export function AiBadge() {
  return <span className="pill bg-lilac px-2 py-0.5 text-xs">AI</span>;
}
