import { useSyncExternalStore } from "react";

const Q = "(prefers-reduced-motion: reduce)";
const mq = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(Q) : null);

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = mq();
      m?.addEventListener("change", cb);
      return () => m?.removeEventListener("change", cb);
    },
    () => mq()?.matches ?? false,
    () => false,
  );
}
