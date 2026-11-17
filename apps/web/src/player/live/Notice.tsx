import type { ReactNode } from "react";

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="lq lq-moon player-notice grid min-h-dvh place-items-center p-6">
      <div className="chunk flex max-w-md items-center gap-4 p-5">
        <div role="status" aria-live="polite" className="font-medium">{children}</div>
      </div>
    </div>
  );
}
