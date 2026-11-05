import type { ReactNode } from "react";

export function Notice({ pip = "pip-think", children }: { pip?: string; children: ReactNode }) {
  return (
    <div className="lq player-notice grid min-h-dvh place-items-center p-6">
      <div className="chunk flex max-w-md items-center gap-4 bg-white p-5">
        <img src={`/img/${pip}.png`} alt="" className="float w-20 shrink-0" />
        <div role="status" aria-live="polite" className="font-bold">{children}</div>
      </div>
    </div>
  );
}
