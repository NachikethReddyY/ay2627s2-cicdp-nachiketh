import type { PreviewRect } from "./previewResize.ts";

export type StoredPreviewWindow = { rect: PreviewRect | null; maximized: boolean };

export const PREVIEW_MEMORY_KEY = "lq.test-editor.preview-window";

const EMPTY: StoredPreviewWindow = { rect: null, maximized: false };

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseStoredPreviewWindow(raw: string | null): StoredPreviewWindow {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY;
    const { rect, maximized } = value as { rect?: unknown; maximized?: unknown };
    const box = rect as Partial<PreviewRect> | null | undefined;
    const validRect = box && isFiniteNumber(box.left) && isFiniteNumber(box.top) && isFiniteNumber(box.width) && isFiniteNumber(box.height)
      ? { left: box.left, top: box.top, width: box.width, height: box.height }
      : null;
    return { rect: validRect, maximized: maximized === true };
  } catch {
    return EMPTY;
  }
}

export function readStoredPreviewWindow(): StoredPreviewWindow {
  try {
    return parseStoredPreviewWindow(window.localStorage.getItem(PREVIEW_MEMORY_KEY));
  } catch {
    return EMPTY;
  }
}

export function writeStoredPreviewWindow(value: StoredPreviewWindow): void {
  try {
    window.localStorage.setItem(PREVIEW_MEMORY_KEY, JSON.stringify(value));
  } catch {
  }
}
