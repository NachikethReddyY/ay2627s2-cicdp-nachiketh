import { z } from "zod";
import { alt, color, id } from "../../core/caps.ts";
import { MAX_EXPR_LEN, FUNCTIONS, evalExpr, parseExpr } from "../../core/expr.ts";
import type { BlockModule, Issue } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";

export const MAX_SERIES = 4;
export const MAX_POINTS = 60;
export const MAX_SLIDERS = 2;
export const KINDS = ["bar", "line", "scatter", "function"] as const;
export const DEFAULT_DOMAIN = [-10, 10] as const;

const num = () => z.number().min(-1e9).max(1e9);

type Slider = { id: string; label: string; min: number; max: number; value?: number };
type Series = { label: string; color?: (typeof import("../../core/caps.ts").THEME_COLORS)[number]; points: { x: number | string; y: number }[] };
type Props = {
  kind: (typeof KINDS)[number];
  alt: string;
  xLabel?: string;
  yLabel?: string;
  series?: Series[];
  expr?: string;
  sliders?: Slider[];
  xMin?: number;
  xMax?: number;
  color?: Series["color"];
};

/** Slider ids may not shadow `x` or a function name, or the expression would be ambiguous. */
const RESERVED_NAMES = ["x", ...Object.keys(FUNCTIONS)];

export const sliderValue = (s: Slider) => s.value ?? s.min;

/** Rows of the data table: bar/line/scatter list each series' points; function samples 5 evenly spaced x values. */
export function table(p: Props): { header: string[]; rows: (string | number)[][] } {
  const xName = p.xLabel ?? "x";
  const yName = p.yLabel ?? "y";
  if (p.kind === "function") {
    const [lo, hi] = [p.xMin ?? DEFAULT_DOMAIN[0], p.xMax ?? DEFAULT_DOMAIN[1]];
    const vars = Object.fromEntries((p.sliders ?? []).map((s) => [s.id, sliderValue(s)]));
    const r = parseExpr(p.expr ?? "", ["x", ...Object.keys(vars)]);
    const rows = [0, 1, 2, 3, 4].map((i) => {
      const x = lo + ((hi - lo) * i) / 4;
      const y = r.ok ? evalExpr(r.ast, { ...vars, x }) : NaN;
      return [x, Number.isNaN(y) ? "undefined" : Math.round(y * 1000) / 1000];
    });
    return { header: [xName, yName], rows };
  }
  const rows = (p.series ?? []).flatMap((s) => s.points.map((pt) => [s.label, pt.x, pt.y]));
  return { header: ["series", xName, yName], rows };
}

export const chartBlock: BlockModule<Props> = {
  type: "chart",
  schema: z.strictObject({
    kind: z.enum(KINDS),
    alt: alt(),
    xLabel: text(40).optional(),
    yLabel: text(40).optional(),
    series: z
      .array(
        z.strictObject({
          label: text(40),
          color: color().optional(),
          points: z.array(z.strictObject({ x: z.union([num(), text(20)]), y: num() })).min(1).max(MAX_POINTS),
        }),
      )
      .min(1)
      .max(MAX_SERIES)
      .optional(),
    expr: text(MAX_EXPR_LEN).optional(),
    sliders: z
      .array(z.strictObject({ id: id(), label: text(30), min: num(), max: num(), value: num().optional() }))
      .max(MAX_SLIDERS)
      .optional(),
    xMin: num().optional(),
    xMax: num().optional(),
    color: color().optional(),
  }),
  check: (b) => {
    const p = b.props;
    const issues: Issue[] = [];
    const bad = (path: string, message: string) => issues.push({ path: `props.${path}`, message });
    if (p.kind === "function") {
      if (p.series) bad("series", "function charts use expr, not series");
      const sliders = p.sliders ?? [];
      const seen = new Set<string>();
      sliders.forEach((s, i) => {
        if (RESERVED_NAMES.includes(s.id)) bad(`sliders.${i}.id`, `"${s.id}" is reserved`);
        else if (seen.has(s.id)) bad(`sliders.${i}.id`, `duplicate slider id "${s.id}"`);
        seen.add(s.id);
        if (!(s.min < s.max)) bad(`sliders.${i}.max`, "max must be greater than min");
        else if (s.value !== undefined && (s.value < s.min || s.value > s.max)) bad(`sliders.${i}.value`, "value must be between min and max");
      });
      if (p.expr === undefined) bad("expr", "function charts need expr");
      else {
        const r = parseExpr(p.expr, ["x", ...sliders.map((s) => s.id)]);
        if (!r.ok) bad("expr", `${r.error} (at position ${r.pos})`);
      }
      if (!((p.xMin ?? DEFAULT_DOMAIN[0]) < (p.xMax ?? DEFAULT_DOMAIN[1]))) bad("xMax", "xMax must be greater than xMin");
    } else {
      if (!p.series) bad("series", `${p.kind} charts need series`);
      for (const k of ["expr", "sliders", "xMin", "xMax", "color"] as const) if (p[k] !== undefined) bad(k, `${k} is only for function charts`);
      p.series?.forEach((s, i) =>
        s.points.forEach((pt, j) => {
          if (p.kind !== "bar" && typeof pt.x !== "number") bad(`series.${i}.points.${j}.x`, `${p.kind} charts need numeric x`);
        }),
      );
    }
    return issues;
  },
  describe: (b) => {
    const p = b.props;
    const { header, rows } = table(p);
    const axes = `X axis: ${p.xLabel ?? "x"}. Y axis: ${p.yLabel ?? "y"}.`;
    const data = `Data table (${header.join(", ")}): ${rows.map((r) => `(${r.join(", ")})`).join("; ")}.`;
    return `Chart (${p.kind}): ${p.alt}. ${axes}${p.kind === "function" ? ` Plots y = ${p.expr}.` : ""} ${data}`;
  },
  prompt: `Use \`chart\` to show numbers: \`kind\` is bar, line, scatter or function. \`alt\` is required: say what the chart shows. Optional \`xLabel\` and \`yLabel\` (up to 40 chars) name the axes.
bar, line and scatter take \`series\`: up to ${MAX_SERIES}, each {label, optional color, points}, with up to ${MAX_POINTS} points {x, y}. For line and scatter x is a number; for bar x may be a short text category. \`color\` is a theme name (ink, green, green-deep, blue, sun, pink, lilac, mint, paper).
function takes \`expr\` instead (up to ${MAX_EXPR_LEN} chars), plotted as y in terms of x, with optional \`xMin\`/\`xMax\` (default -10 to 10), optional \`color\`, and up to ${MAX_SLIDERS} \`sliders\` {id, label, min, max, optional value} whose ids can be used in expr (ids must not be x or a function name).
expr allows only numbers, x, slider ids, + - * / ^, parentheses, unary minus, and sin cos tan sqrt abs exp log (one argument) and min max (two arguments). Nothing else: no other names, text, or symbols.
Example: {"type":"chart","id":"parab","props":{"kind":"function","alt":"A parabola y = a times x squared, opening wider as a shrinks","expr":"a * x^2","sliders":[{"id":"a","label":"Steepness","min":0.1,"max":3,"value":1}],"xLabel":"x","yLabel":"y"}}`,
  budget: 4,
};
