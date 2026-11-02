// Pure mapping from a stage shape plus timeline state to SVG attributes. No React or DOM, so node --test can run it.
import { THEME_COLORS, type StageProps, type TimelineState } from "@learnquest/ui-catalog";

export type StageShape = StageProps["shapes"][number];
export type Resolved = {
  /** Offset from the shape's own x,y; applied as a CSS transform so it can tween. */
  dx: number;
  dy: number;
  opacity: number;
  fill: string;
  stroke: string;
  w: number;
  h: number;
  r: number;
  /** Where the label is drawn, relative to the shape's own x,y (before dx,dy). */
  label: { x: number; y: number };
};

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const isColor = (v: unknown): v is string => typeof v === "string" && (THEME_COLORS as readonly string[]).includes(v);
const css = (state: unknown, own: string | undefined, fallback: string) => `var(--color-${isColor(state) ? state : isColor(own) ? own : fallback})`;

export function resolve(s: StageShape, state: TimelineState | undefined): Resolved {
  const t = state?.[s.id];
  const w = num(t?.w, s.w ?? 0);
  const h = num(t?.h, s.h ?? 0);
  const r = num(t?.r, s.r ?? 0);
  const label =
    s.kind === "rect" ? { x: s.x + w / 2, y: s.y + h / 2 }
    : s.kind === "line" ? { x: (s.x + (s.x2 ?? s.x)) / 2, y: (s.y + (s.y2 ?? s.y)) / 2 }
    : { x: s.x, y: s.y };
  return {
    dx: num(t?.x, s.x) - s.x,
    dy: num(t?.y, s.y) - s.y,
    opacity: Math.min(1, Math.max(0, num(t?.opacity, 1))),
    fill: css(t?.fill, s.fill, s.kind === "text" ? "ink" : "paper"),
    stroke: css(t?.stroke, s.stroke, "ink"),
    w,
    h,
    r,
    label,
  };
}
