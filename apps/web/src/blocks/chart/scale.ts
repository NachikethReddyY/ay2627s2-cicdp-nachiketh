
export type Range = [number, number];

export const linear = ([d0, d1]: Range, [r0, r1]: Range) => (v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

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

const clean = (n: number) => Number(n.toPrecision(12));

export function fmt(n: number): string {
  if (Number.isNaN(n)) return "undefined";
  if (n === 0) return "0";
  const a = Math.abs(n);
  return a >= 1e6 || a < 1e-3 ? n.toExponential(1).replace(".0e", "e").replace("e+", "e") : String(Number(n.toPrecision(3)));
}

export function extent(values: number[], includeZero = false): Range {
  const v = values.filter(Number.isFinite);
  if (includeZero) v.push(0);
  return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1];
}

export const sample = (f: (x: number) => number, lo: number, hi: number, n = 120): [number, number][] =>
  Array.from({ length: n }, (_, i) => { const x = lo + ((hi - lo) * i) / (n - 1); return [x, f(x)]; });

export function curveRange(points: [number, number][]): Range {
  const ys = points.map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ys.length) return [0, 1];
  const [lo, hi] = [ys[Math.floor(0.02 * (ys.length - 1))], ys[Math.ceil(0.98 * (ys.length - 1))]];
  const pad = (hi - lo || 1) * 0.05;
  return [lo - pad, hi + pad];
}

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
