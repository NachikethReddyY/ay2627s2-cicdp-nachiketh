import { useEffect, useReducer, useRef } from "react";
import type { Dispatch, RefObject } from "react";

export const PANEL_KEY = "lq.terminal";
export const MIN_HEIGHT = 120;
export const MAX_FRACTION = 0.7;
export const DEFAULT_HEIGHT = 240;
export const KEY_STEP = 16;

export type PanelState = { open: boolean; height: number; everOpened: boolean };
export type PanelAction =
  | { type: "toggle" }
  | { type: "open" }
  | { type: "close" }
  | { type: "resize"; px: number; container: number };

// Clamp a panel height to [MIN_HEIGHT, max(MIN_HEIGHT, MAX_FRACTION * container)].
// A NaN request falls back to DEFAULT_HEIGHT. A non-finite container leaves the top unbounded.
export function clampHeight(px: number, container: number): number {
  if (Number.isNaN(px)) return DEFAULT_HEIGHT;
  const max = Number.isFinite(container) ? Math.max(MIN_HEIGHT, MAX_FRACTION * container) : Infinity;
  return Math.min(max, Math.max(MIN_HEIGHT, px));
}

export function panelReducer(s: PanelState, a: PanelAction): PanelState {
  switch (a.type) {
    case "toggle": {
      const open = !s.open;
      return { ...s, open, everOpened: s.everOpened || open };
    }
    case "open":
      return { ...s, open: true, everOpened: true };
    case "close":
      return { ...s, open: false };
    case "resize":
      return { ...s, height: clampHeight(a.px, a.container) };
  }
}

function defaultState(): PanelState {
  return { open: false, height: DEFAULT_HEIGHT, everOpened: false };
}

export function loadPanel(store: Pick<Storage, "getItem"> | undefined): PanelState {
  let raw: string | null;
  try {
    raw = store?.getItem(PANEL_KEY) ?? null;
  } catch {
    return defaultState();
  }
  if (raw == null) return defaultState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultState();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaultState();
  const { open, height } = parsed as { open?: unknown; height?: unknown };
  const isOpen = open === true;
  const h = typeof height === "number" && Number.isFinite(height) ? Math.max(MIN_HEIGHT, height) : DEFAULT_HEIGHT;
  return { open: isOpen, height: h, everOpened: isOpen };
}

export function savePanel(store: Pick<Storage, "setItem"> | undefined, s: PanelState): void {
  try {
    store?.setItem(PANEL_KEY, JSON.stringify({ open: s.open, height: s.height }));
  } catch {
    // Storage can be full or blocked; the panel still works without persistence.
  }
}

// Ctrl+` on any keyboard layout (matched by physical key code), with no other modifiers.
export function isToggleKey(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code">): boolean {
  return e.code === "Backquote" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// With a containerRef the stored height is re-clamped (and saved) whenever the window resizes.
// Without one the caller clamps at render (the workbench does), so only a user resize changes it.
export function usePanel(containerRef?: RefObject<HTMLElement | null>): {
  state: PanelState;
  dispatch: Dispatch<PanelAction>;
} {
  const [state, dispatch] = useReducer(panelReducer, undefined, () => loadPanel(safeLocalStorage()));
  const heightRef = useRef(state.height);
  heightRef.current = state.height;

  useEffect(() => {
    savePanel(safeLocalStorage(), state);
  }, [state]);

  useEffect(() => {
    if (!containerRef) return;
    const reclamp = () => {
      const container = containerRef.current?.clientHeight || window.innerHeight;
      dispatch({ type: "resize", px: heightRef.current, container });
    };
    reclamp();
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [containerRef]);

  return { state, dispatch };
}
