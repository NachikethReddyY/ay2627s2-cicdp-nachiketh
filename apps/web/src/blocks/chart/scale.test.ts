import test from "node:test";
import assert from "node:assert/strict";
import { curveRange, extent, fmt, linear, niceTicks, sample, segments } from "./scale.ts";

test("linear maps the domain onto the range, and a flat domain to the middle", () => {
  const s = linear([0, 10], [100, 0]);
  assert.deepEqual([s(0), s(5), s(10)], [100, 50, 0]);
  assert.equal(linear([3, 3], [0, 10])(3), 5);
});

test("niceTicks are round, ordered and cover the data", () => {
  assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(-10, 10), [-10, -5, 0, 5, 10]);
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  const t = niceTicks(0.13, 97.2);
  assert.ok(t[0]! <= 0.13 && t.at(-1)! >= 97.2);
  assert.ok(t.length <= 12);
  assert.deepEqual(niceTicks(5, 5), niceTicks(4, 6));
  assert.deepEqual(niceTicks(NaN, 3), [0, 1]);
});

test("fmt keeps labels short", () => {
  assert.equal(fmt(0), "0");
  assert.equal(fmt(0.1 + 0.2), "0.3");
  assert.equal(fmt(1234.5), "1230");
  assert.equal(fmt(2500000), "2.5e6");
  assert.equal(fmt(NaN), "undefined");
});

test("extent ignores non-finite values and can pin zero", () => {
  assert.deepEqual(extent([3, NaN, 7, Infinity]), [3, 7]);
  assert.deepEqual(extent([3, 7], true), [0, 7]);
  assert.deepEqual(extent([]), [0, 1]);
});

test("curves: sampling endpoints, outlier-robust range, breaks at NaN", () => {
  const pts = sample((x) => x * x, -2, 2, 5);
  assert.deepEqual(pts.map((p) => p[0]), [-2, -1, 0, 1, 2]);
  const tan = sample(Math.tan, -3, 3, 200);
  const [lo, hi] = curveRange(tan);
  assert.ok(hi - lo < 1e4);
  const sqrt = sample(Math.sqrt, -2, 2, 9).map(([x, y]) => [x, y] as [number, number]);
  assert.equal(segments(sqrt, [0, 2]).length, 1);
  assert.deepEqual(segments([[0, 1], [1, NaN], [2, 1]], [0, 2]).map((s) => s.length), [1, 1]);
  assert.deepEqual(segments([[0, 1], [1, 1000], [2, 1]], [0, 2]).map((s) => s.length), [1, 1]);
});
