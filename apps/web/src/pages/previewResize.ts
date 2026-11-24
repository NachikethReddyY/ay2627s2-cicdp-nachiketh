export type PreviewRect = { left: number; top: number; width: number; height: number };

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_WIDTH = 300;
const MIN_HEIGHT = 240;
const MARGIN = 8;

export function resizeRect(
  start: PreviewRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
  minWidth = MIN_WIDTH,
): PreviewRect {
  let { left, top, width, height } = start;
  const right = start.left + start.width;
  const bottom = start.top + start.height;

  if (edge.includes("e")) {
    const max = bounds.width - MARGIN - start.left;
    width = Math.max(minWidth, Math.min(start.width + dx, max));
  } else if (edge.includes("w")) {
    left = Math.max(MARGIN, Math.min(start.left + dx, right - minWidth));
    width = right - left;
  }

  if (edge.includes("s")) {
    const max = bounds.height - MARGIN - start.top;
    height = Math.max(MIN_HEIGHT, Math.min(start.height + dy, max));
  } else if (edge.includes("n")) {
    top = Math.max(MARGIN, Math.min(start.top + dy, bottom - MIN_HEIGHT));
    height = bottom - top;
  }

  return { left, top, width, height };
}
