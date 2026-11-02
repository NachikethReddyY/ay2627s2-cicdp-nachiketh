import { useId, useState, type ReactNode } from "react";
import { DEFAULT_DOMAIN, chartTable, evalExpr, parseExpr, sliderValue, type ChartProps } from "@learnquest/ui-catalog";
import type { BlockViewProps } from "../registry.ts";
import { curveRange, extent, fmt, linear, niceTicks, sample, segments, type Range } from "./scale.ts";

const W = 360, H = 260;
const M = { l: 48, r: 12, t: 12, b: 44 };
const PLOT_X: Range = [M.l, W - M.r];
const PLOT_Y: Range = [H - M.b, M.t];
const FALLBACK = ["blue", "pink", "green-deep", "lilac"] as const;
const css = (c: string) => `var(--color-${c})`;
const TICK = { fontSize: 12, fill: "var(--color-ink)" } as const;
const INK = "var(--color-ink)";

type Tick = { at: number; label: string };
type Plot = { xTicks: Tick[]; yTicks: Tick[]; marks: ReactNode; zero?: { x?: number; y?: number } };

const path = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
const colorOf = (p: ChartProps, i: number) => p.series?.[i]?.color ?? FALLBACK[i % FALLBACK.length]!;

function yScale(values: number[], includeZero: boolean, fixed?: Range) {
  const ticks = niceTicks(...(fixed ?? extent(values, includeZero)));
  const dom: Range = [ticks[0]!, ticks.at(-1)!];
  const y = linear(dom, PLOT_Y);
  return { y, yTicks: ticks.map((t) => ({ at: y(t), label: fmt(t) })), dom };
}

function bars(p: ChartProps): Plot {
  const series = p.series ?? [];
  const cats = [...new Set(series.flatMap((s) => s.points.map((pt) => String(pt.x))))];
  const { y, yTicks } = yScale(series.flatMap((s) => s.points.map((pt) => pt.y)), true);
  const band = (PLOT_X[1] - PLOT_X[0]) / cats.length;
  const bw = (band * 0.8) / series.length;
  const every = Math.ceil(cats.length / Math.max(1, Math.floor((PLOT_X[1] - PLOT_X[0]) / 44)));
  const maxChars = Math.max(3, Math.floor((band * every) / 6.5));
  const xTicks = cats.flatMap((c, i) => (i % every ? [] : [{ at: PLOT_X[0] + band * (i + 0.5), label: c.length > maxChars ? c.slice(0, maxChars - 1) + "…" : c }]));
  const base = y(0);
  const marks = series.map((s, si) => s.points.map((pt, k) => {
    const top = y(pt.y);
    return <rect key={`${si}-${k}`} x={PLOT_X[0] + band * (cats.indexOf(String(pt.x)) + 0.1) + bw * si} y={Math.min(top, base)} width={bw} height={Math.abs(base - top)}
      fill={css(colorOf(p, si))} stroke={INK} strokeWidth={1.5} />;
  }));
  return { xTicks, yTicks, marks, zero: { y: base } };
}

function points(p: ChartProps): Plot {
  const series = p.series ?? [];
  const all = series.flatMap((s) => s.points.map((pt) => ({ x: Number(pt.x), y: pt.y })));
  const xt = niceTicks(...extent(all.map((a) => a.x)));
  const x = linear([xt[0]!, xt.at(-1)!], PLOT_X);
  const { y, yTicks } = yScale(all.map((a) => a.y), false);
  const marks = series.map((s, si) => {
    const pts = s.points.map((pt): [number, number] => [x(Number(pt.x)), y(pt.y)]);
    if (p.kind === "line") pts.sort((a, b) => a[0] - b[0]);
    return (
      <g key={si} fill={css(colorOf(p, si))} stroke={INK} strokeWidth={1.5}>
        {p.kind === "line" && <path d={path(pts)} fill="none" stroke={css(colorOf(p, si))} strokeWidth={3} strokeLinejoin="round" />}
        {pts.map(([cx, cy], k) => <circle key={k} cx={cx} cy={cy} r={p.kind === "line" ? 3.5 : 5} />)}
      </g>
    );
  });
  return { xTicks: xt.map((t) => ({ at: x(t), label: fmt(t) })), yTicks, marks };
}

function curve(p: ChartProps, vals: Record<string, number>): Plot {
  const [lo, hi] = [p.xMin ?? DEFAULT_DOMAIN[0], p.xMax ?? DEFAULT_DOMAIN[1]];
  const parsed = parseExpr(p.expr ?? "", ["x", ...Object.keys(vals)]);
  const pts = sample((x) => (parsed.ok ? evalExpr(parsed.ast, { ...vals, x }) : NaN), lo, hi);
  const xt = niceTicks(lo, hi);
  const x = linear([lo, hi], PLOT_X);
  const { y, yTicks, dom } = yScale([], false, curveRange(pts));
  const runs = segments(pts, dom).map((r) => r.map(([a, b]): [number, number] => [x(a), y(b)]));
  const marks = runs.map((r, i) => <path key={i} d={path(r)} fill="none" stroke={css(p.color ?? "blue")} strokeWidth={3} strokeLinejoin="round" />);
  return {
    xTicks: xt.filter((t) => t >= lo && t <= hi).map((t) => ({ at: x(t), label: fmt(t) })), yTicks, marks,
    zero: { x: lo < 0 && hi > 0 ? x(0) : undefined, y: dom[0] < 0 && dom[1] > 0 ? y(0) : undefined },
  };
}

export default function ChartView({ block }: BlockViewProps<ChartProps>) {
  const p = block.props;
  const uid = useId();
  const sliders = p.sliders ?? [];
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(sliders.map((s) => [s.id, sliderValue(s)])));
  const { header, rows } = chartTable({ ...p, sliders: sliders.map((s) => ({ ...s, value: vals[s.id] })) });
  const plot = p.kind === "function" ? curve(p, vals) : p.kind === "bar" ? bars(p) : points(p);
  const series = p.series ?? [];

  return (
    <figure className="m-0 min-w-0 max-w-full">
      <svg role="img" aria-label={p.alt} viewBox={`0 0 ${W} ${H}`} width={W} height={H}
        style={{ maxWidth: "100%", height: "auto", aspectRatio: `${W} / ${H}` }}
        className="block rounded-2xl border-2 border-ink bg-white" fontFamily="inherit">
        <clipPath id={`${uid}clip`}><rect x={M.l} y={M.t} width={PLOT_X[1] - M.l} height={PLOT_Y[0] - M.t} /></clipPath>
        {plot.yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={M.l} x2={PLOT_X[1]} y1={t.at} y2={t.at} stroke={INK} strokeOpacity={0.15} />
            <text x={M.l - 6} y={t.at} textAnchor="end" dominantBaseline="central" {...TICK}>{t.label}</text>
          </g>
        ))}
        {plot.xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={t.at} x2={t.at} y1={PLOT_Y[0]} y2={PLOT_Y[0] + 4} stroke={INK} />
            <text x={t.at} y={PLOT_Y[0] + 17} textAnchor="middle" {...TICK}>{t.label}</text>
          </g>
        ))}
        <line x1={M.l} x2={PLOT_X[1]} y1={PLOT_Y[0]} y2={PLOT_Y[0]} stroke={INK} strokeWidth={2} />
        <line x1={M.l} x2={M.l} y1={M.t} y2={PLOT_Y[0]} stroke={INK} strokeWidth={2} />
        <g clipPath={`url(#${uid}clip)`}>
          {plot.zero?.y !== undefined && <line x1={M.l} x2={PLOT_X[1]} y1={plot.zero.y} y2={plot.zero.y} stroke={INK} strokeWidth={1.5} />}
          {plot.zero?.x !== undefined && <line x1={plot.zero.x} x2={plot.zero.x} y1={M.t} y2={PLOT_Y[0]} stroke={INK} strokeWidth={1.5} />}
          {plot.marks}
        </g>
        {p.xLabel && <text x={(PLOT_X[0] + PLOT_X[1]) / 2} y={H - 6} textAnchor="middle" {...TICK} fontWeight={700}>{p.xLabel}</text>}
        {p.yLabel && <text transform={`translate(13 ${(PLOT_Y[0] + PLOT_Y[1]) / 2}) rotate(-90)`} textAnchor="middle" {...TICK} fontWeight={700}>{p.yLabel}</text>}
      </svg>

      {series.length > 1 && (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
          {series.map((s, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1">
              <span aria-hidden className="inline-block size-3 shrink-0 rounded-sm border-2 border-ink" style={{ background: css(colorOf(p, i)) }} />
              <span className="break-words">{s.label}</span>
            </li>
          ))}
        </ul>
      )}

      {sliders.map((s) => (
        <div key={s.id} className="mt-2">
          <label htmlFor={`${uid}${s.id}`} className="flex justify-between gap-2 text-sm font-bold">
            <span className="break-words">{s.label}</span>
            <output htmlFor={`${uid}${s.id}`}>{fmt(vals[s.id] ?? sliderValue(s))}</output>
          </label>
          <input id={`${uid}${s.id}`} type="range" min={s.min} max={s.max} step={(s.max - s.min) / 100}
            value={vals[s.id] ?? sliderValue(s)} onChange={(e) => setVals((v) => ({ ...v, [s.id]: Number(e.target.value) }))}
            className="block h-11 w-full min-w-0 cursor-pointer accent-ink" />
        </div>
      ))}

      <details className="mt-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center font-extrabold">Data table</summary>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{p.alt}</caption>
            <thead><tr>{header.map((h, i) => <th key={i} scope="col" className="border-b-2 border-ink px-2 py-1">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="break-words border-b border-ink/30 px-2 py-1">{typeof c === "number" ? fmt(c) : c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
