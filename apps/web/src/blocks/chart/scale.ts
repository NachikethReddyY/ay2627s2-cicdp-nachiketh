/** Pure chart helpers: scales, tick generation, number formatting, function sampling. */

export type Range = [number, number];

/** Maps `[d0, d1]` linearly onto `[r0, r1]`; a zero-width domain maps to the middle of the range. */
export const linear = ([d0, d1]: Range, [r0, r1]: Range) => (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** "Nice" tick values (1, 2 or 5 times a power of ten) covering [lo, hi]; the first and last ticks may lie just outside it. */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const first = Math.floor(lo / step), last = Math.ceil(hi / step);
  return Array.from({ length: last - first + 1 }, (_, i) => clean((first + i) * step));
}

/** Drops float noise such as 0.30000000000000004. */
const clean = (n: number) => Number(n.toPrecision(12));

/** Short tick/table label: at most 3 significant digits, no trailing zeros, exponent for extremes. */
export function fmt(n: number): string {
  if (Number.isNaN(n)) return "undefined";
  if (n === 0) return "0";
  const a = Math.abs(n);
  return a >= 1e6 || a < 1e-3 ? n.toExponential(1).replace(".0e", "e").replace("e+", "e") : String(Number(n.toPrecision(3)));
}

/** [min, max] of the finite values; `includeZero` pins the baseline (bars). Falls back to [0, 1]. */
export function extent(values: number[], includeZero = false): Range {
  const v = values.filter(Number.isFinite);
  if (includeZero) v.push(0);
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1];
}

/** Evenly spaced x in [lo, hi], n >= 2 samples. */
export const sample = (f: (x: number) => number, lo: number, hi: number, n = 120): [number, number][] =>
  Array.from({ length: n }, (_, i) => { const x = lo + ((hi - lo) * i) / (n - 1); return [x, f(x)]; });

/**
 * y range for a sampled curve. Outliers (tan near its poles) are ignored by using the 2nd to 98th percentile
 * of the finite values, then padded by 5%.
 */
export function curveRange(points: [number, number][]): Range {
  const ys = points.map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ys.length) return [0, 1];
  const [lo, hi] = [ys[Math.floor(0.02 * (ys.length - 1))]!, ys[Math.ceil(0.98 * (ys.length - 1))]!];
  const pad = (hi - lo || 1) * 0.05;
  return [lo - pad, hi + pad];
}

/** Splits a curve into drawable runs: NaN, or a value more than one range-height outside `y`, breaks the line. */
export function segments(points: [number, number][], [lo, hi]: Range): [number, number][][] {
  const span = hi - lo;
  const out: [number, number][][] = [];
  let run: [number, number][] = [];
  for (const p of points) {
    if (Number.isFinite(p[1]) && p[1] >= lo - span && p[1] <= hi + span) run.push(p);
    else if (run.length) { out.push(run); run = []; }
  }
  if (run.length) out.push(run);
  return out;
}
