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
  text: string;
  w: number;
  h: number;
  r: number;
  /** Where the label is drawn, relative to the shape's own x,y (before dx,dy). */
  label: { x: number; y: number };
  labelPill: boolean;
};

export function segment(prevStep: number, step: number, reduced: boolean, poses: number[]): [number, number] | null {
  return !reduced && step === prevStep + 1 ? [poses[prevStep]!, poses[step]!] : null;
}

export function bodyState(id: string, y: number): TimelineState {
  const state: TimelineState = Object.create(null);
  state[id] = { y };
  return state;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const isColor = (v: unknown): v is string => typeof v === "string" && (THEME_COLORS as readonly string[]).includes(v);
const tokenName = (v: string) => v === "green" ? "mint" : v === "green-deep" ? "ink" : v;
const css = (state: unknown, own: string | undefined, fallback: string) => `var(--color-${tokenName(isColor(state) ? state : isColor(own) ? own : fallback)})`;

const palette: Record<string, { fill: string; stroke: string; text: string }> = {
  sun: { fill: "sun", stroke: "ink", text: "ink" }, blue: { fill: "blue", stroke: "ink", text: "white" },
  green: { fill: "mint", stroke: "ink", text: "ink" }, pink: { fill: "pink", stroke: "ink", text: "ink" },
  lilac: { fill: "lilac", stroke: "ink", text: "ink" }, mint: { fill: "mint", stroke: "ink", text: "ink" },
  ink: { fill: "ink", stroke: "ink", text: "paper" }, "green-deep": { fill: "ink", stroke: "ink", text: "paper" },
  paper: { fill: "paper", stroke: "ink", text: "ink" },
};

export function resolve(s: StageShape, state: TimelineState | undefined): Resolved {
  const t = state?.[s.id];
  const w = num(t?.w, s.w ?? 0);
  const h = num(t?.h, s.h ?? 0);
  const r = num(t?.r, s.r ?? 0);
  const labelPill = (s.kind === "circle" && r < 15) || ((s.kind === "rect" || s.kind === "ellipse") && h < 20);
  const label =
    s.kind === "rect" ? { x: s.x + w / 2, y: s.y + h / 2 }
    : s.kind === "line" ? { x: (s.x + (s.x2 ?? s.x)) / 2, y: (s.y + (s.y2 ?? s.y)) / 2 }
    : { x: s.x, y: s.y };
  if (labelPill) label.y -= (s.kind === "circle" ? r : h / 2) + 4;
  const token = tokenName(isColor(t?.fill) ? t!.fill as string : isColor(s.fill) ? s.fill : s.kind === "text" ? "ink" : "paper");
  const colors = palette[token] ?? palette.paper!;
  return {
    dx: num(t?.x, s.x) - s.x,
    dy: num(t?.y, s.y) - s.y,
    opacity: Math.min(1, Math.max(0, num(t?.opacity, 1))),
    fill: css(t?.fill, s.fill, colors.fill),
    stroke: css(t?.stroke, s.stroke, colors.stroke),
    text: `var(--color-${colors.text})`,
    w,
    h,
    r,
    label,
    labelPill,
  };
}
