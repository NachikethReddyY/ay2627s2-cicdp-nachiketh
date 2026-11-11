import type { PreviewRect } from "./previewResize.ts";

export const CODE_WINDOW_KEY = "lq.test-editor.code-window";

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Parse the stored box. Anything malformed gives null, so the window falls back to its default size. */
export function parseStoredCodeWindow(raw: string | null): PreviewRect | null {
  if (!raw) return null;
  try {
    const box = JSON.parse(raw) as Partial<PreviewRect> | null;
    if (box && isFiniteNumber(box.left) && isFiniteNumber(box.top) && isFiniteNumber(box.width) && isFiniteNumber(box.height)) {
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    }
    return null;
  } catch {
    return null;
  }
}

/** Storage can be blocked (private windows), so every failure gives the default. */
export function readStoredCodeWindow(): PreviewRect | null {
  try {
    return parseStoredCodeWindow(window.localStorage.getItem(CODE_WINDOW_KEY));
  } catch {
    return null;
  }
}

export function writeStoredCodeWindow(rect: PreviewRect): void {
  try {
    window.localStorage.setItem(CODE_WINDOW_KEY, JSON.stringify(rect));
  } catch {
    // Storage is blocked or full: the window still works, it just forgets its place.
  }
}
