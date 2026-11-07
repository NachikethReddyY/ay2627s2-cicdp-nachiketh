import { useEffect, useReducer } from "react";
import type { Dispatch } from "react";

export const LAYOUT_KEY = "lq.workbench";
export const THEME_KEY = "lq.theme";
export const LEFT_MIN = 240;
export const LEFT_MAX_FRACTION = 0.75;
export const UTIL_MIN = 200;
export const UTIL_MAX = 420;
export const EDITOR_MIN = 360;

export type Theme = "light" | "dark" | "system";
export type Layout = {
  leftW: number;
  utilW: number;
  showLeft: boolean;
  showUtil: boolean;
  leftView: "files" | "problems";
  utilTab: "instructions" | "docs";
  theme: Theme;
};
export type LayoutAction =
  | { type: "toggleLeft" }
  | { type: "toggleUtil" }
  | { type: "resizeLeft"; px: number; container: number }
  | { type: "resizeUtil"; px: number; container: number }
  | { type: "leftView"; view: Layout["leftView"] }
  | { type: "utilTab"; tab: Layout["utilTab"] }
  | { type: "theme"; theme: Theme };

// "system" follows the OS colour scheme; the other two ignore it.
export function resolveTheme(t: Theme, prefersDark: boolean): "light" | "dark" {
  return t === "system" ? (prefersDark ? "dark" : "light") : t;
}

export const DEFAULT_LAYOUT: Layout = {
  leftW: 280,
  utilW: 320,
  showLeft: true,
  showUtil: true,
  leftView: "files",
  utilTab: "instructions",
  theme: "system",
};

const THEMES: readonly Theme[] = ["light", "dark", "system"];
const LEFT_VIEWS: readonly Layout["leftView"][] = ["files", "problems"];
const UTIL_TABS: readonly Layout["utilTab"][] = ["instructions", "docs"];

function clamp(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, px));
}

function maxLeftWidth(container: number): number {
  return Number.isFinite(container) ? Math.max(LEFT_MIN, Math.floor(container * LEFT_MAX_FRACTION)) : Number.MAX_SAFE_INTEGER;
}

// Largest navigator width that still leaves the editor EDITOR_MIN px.
function leftLimit(s: Layout, container: number): number {
  if (!Number.isFinite(container)) return Number.MAX_SAFE_INTEGER;
  const room = container - (s.showUtil ? s.utilW : 0) - EDITOR_MIN;
  return clamp(room, LEFT_MIN, maxLeftWidth(container));
}

// Largest utility width that still leaves the editor EDITOR_MIN px.
function utilLimit(s: Layout, container: number): number {
  if (!Number.isFinite(container)) return UTIL_MAX;
  const room = container - (s.showLeft ? s.leftW : 0) - EDITOR_MIN;
  return clamp(room, UTIL_MIN, UTIL_MAX);
}

// Put both widths inside their design ranges, then, if the visible panels leave
// the editor less than EDITOR_MIN px, shrink the utility area first and the
// navigator second. If even the minimums do not fit, the minimums are returned.
export function clampLayout(s: Layout, container: number): Layout {
  let leftW = s.showLeft ? clamp(s.leftW, LEFT_MIN, maxLeftWidth(container)) : clamp(s.leftW, LEFT_MIN, Number.MAX_SAFE_INTEGER);
  let utilW = clamp(s.utilW, UTIL_MIN, UTIL_MAX);
  if (Number.isFinite(container)) {
    let over = (s.showLeft ? leftW : 0) + (s.showUtil ? utilW : 0) + EDITOR_MIN - container;
    if (over > 0 && s.showUtil) {
      const cut = Math.min(over, utilW - UTIL_MIN);
      utilW -= cut;
      over -= cut;
    }
    if (over > 0 && s.showLeft) {
      leftW -= Math.min(over, leftW - LEFT_MIN);
    }
  }
  return { ...s, leftW, utilW };
}

export function layoutReducer(s: Layout, a: LayoutAction): Layout {
  switch (a.type) {
    case "toggleLeft":
      return { ...s, showLeft: !s.showLeft };
    case "toggleUtil":
      return { ...s, showUtil: !s.showUtil };
    case "resizeLeft":
      if (Number.isNaN(a.px)) return s;
      return { ...s, leftW: clamp(a.px, LEFT_MIN, leftLimit(s, a.container)) };
    case "resizeUtil":
      if (Number.isNaN(a.px)) return s;
      return { ...s, utilW: clamp(a.px, UTIL_MIN, utilLimit(s, a.container)) };
    case "leftView":
      return { ...s, leftView: a.view };
    case "utilTab":
      return { ...s, utilTab: a.tab };
    case "theme":
      return { ...s, theme: a.theme };
  }
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function readRaw(store: Pick<Storage, "getItem"> | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

// The theme lives under its own key (lq.theme) so the plan's storage contract holds.
// Anything other than a known theme string falls back to "system".
function parseTheme(raw: string | null): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : DEFAULT_LAYOUT.theme;
}

// Each field is checked on its own: a bad field falls back to its default and
// the valid fields are kept. The theme comes from lq.theme, the rest from lq.workbench.
export function loadLayout(store: Pick<Storage, "getItem"> | undefined): Layout {
  const theme = parseTheme(readRaw(store, THEME_KEY));
  const raw = readRaw(store, LAYOUT_KEY);
  if (raw == null) return { ...DEFAULT_LAYOUT, theme };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LAYOUT, theme };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_LAYOUT, theme };
  const p = parsed as Record<string, unknown>;
  return {
      // 300 px was the old navigator minimum; treat that value as the old
      // default so existing workbench layouts pick up the slimmer navigator.
      leftW: p.leftW === 300 ? DEFAULT_LAYOUT.leftW : inRange(p.leftW, LEFT_MIN, Number.MAX_SAFE_INTEGER) ? p.leftW : DEFAULT_LAYOUT.leftW,
    utilW: inRange(p.utilW, UTIL_MIN, UTIL_MAX) ? p.utilW : DEFAULT_LAYOUT.utilW,
    showLeft: typeof p.showLeft === "boolean" ? p.showLeft : DEFAULT_LAYOUT.showLeft,
    showUtil: typeof p.showUtil === "boolean" ? p.showUtil : DEFAULT_LAYOUT.showUtil,
    leftView: LEFT_VIEWS.includes(p.leftView as Layout["leftView"]) ? (p.leftView as Layout["leftView"]) : DEFAULT_LAYOUT.leftView,
    utilTab: UTIL_TABS.includes(p.utilTab as Layout["utilTab"]) ? (p.utilTab as Layout["utilTab"]) : DEFAULT_LAYOUT.utilTab,
    theme,
  };
}

// Writes theme to lq.theme and the other fields to lq.workbench. Each write is
// guarded on its own, so a failing write does not stop the other one.
export function saveLayout(store: Pick<Storage, "setItem"> | undefined, s: Layout): void {
  const { theme, ...rest } = s;
  try {
    store?.setItem(LAYOUT_KEY, JSON.stringify(rest));
  } catch {
    // Storage can be full or blocked; the layout still works without persistence.
  }
  try {
    store?.setItem(THEME_KEY, theme);
  } catch {
    // As above.
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// Toggles and resizes do not re-clamp: consumers must call clampLayout at render
// with the current container width.
export function useLayout(): [Layout, Dispatch<LayoutAction>] {
  const [layout, dispatch] = useReducer(layoutReducer, undefined, () => loadLayout(safeLocalStorage()));

  useEffect(() => {
    saveLayout(safeLocalStorage(), layout);
  }, [layout]);

  return [layout, dispatch];
}
