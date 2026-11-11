/** The floating preview window's box, in viewport pixels. */
export type PreviewRect = { left: number; top: number; width: number; height: number };

/** The edge or corner being dragged: n, s, e, w, or a corner such as "ne". */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Match .wb-preview-float's min-width and min-height, and keep 8px clear of the viewport edge.
const MIN_WIDTH = 300;
const MIN_HEIGHT = 240;
const MARGIN = 8;

/**
 * The box after dragging `edge` by (dx, dy) from `start`. The edge opposite the one dragged stays put.
 * Size is clamped to the window's minimum and to the viewport (with an 8px margin).
 */
export function resizeRect(
  start: PreviewRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
): PreviewRect {
  let { left, top, width, height } = start;
  const right = start.left + start.width;
  const bottom = start.top + start.height;

  if (edge.includes("e")) {
    const max = bounds.width - MARGIN - start.left;
    width = Math.max(MIN_WIDTH, Math.min(start.width + dx, max));
  } else if (edge.includes("w")) {
    left = Math.max(MARGIN, Math.min(start.left + dx, right - MIN_WIDTH));
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
