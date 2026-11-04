import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { clampStep, stateAt, stepCount, timelineSchema, type Timeline } from "../src/index.ts";

const step = (set: Timeline["steps"][number]["set"] = [], caption = "Step") => ({ caption, durationMs: 1000, set });
const t: Timeline = timelineSchema.parse({
  steps: [
    step([{ id: "box", prop: "x", value: 0 }, { id: "box", prop: "fill", value: "green" }]),
    step([{ id: "box", prop: "x", value: 50 }]),
    step([{ id: "dot", prop: "visible", value: true }, { id: "box", prop: "x", value: 100 }]),
  ],
});
// State records have a null prototype; strict deepEqual compares prototypes.
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test("stateAt applies steps up to i, later steps overriding earlier ones", () => {
  assert.equal(stepCount(t), 3);
  assert.deepEqual(plain(stateAt(t, 0)), { box: { x: 0, fill: "green" } });
  assert.deepEqual(plain(stateAt(t, 1)), { box: { x: 50, fill: "green" } });
  assert.deepEqual(plain(stateAt(t, 2)), { box: { x: 100, fill: "green" }, dot: { visible: true } });
});

test("out-of-range and non-integer i clamp", () => {
  assert.deepEqual([-5, 99, 1.7, NaN, Infinity, -Infinity].map((i) => clampStep(t, i)), [0, 2, 1, 0, 2, 0]);
  assert.deepEqual(plain(stateAt(t, 99)), plain(stateAt(t, 2)));
  assert.deepEqual(plain(stateAt(t, -1)), plain(stateAt(t, 0)));
});

test("stateAt is deterministic, does not mutate input, and ids like __proto__ stay plain keys", () => {
  const before = JSON.stringify(t);
  fc.assert(fc.property(fc.integer({ min: -40, max: 40 }), (i) => {
    assert.deepEqual(plain(stateAt(t, i)), plain(stateAt(t, i)));
  }));
  assert.equal(JSON.stringify(t), before);
  const p = timelineSchema.parse({ steps: [step([{ id: "__proto__", prop: "__proto__", value: 1 }])] });
  assert.equal(stateAt(p, 0)["__proto__"]!["__proto__"], 1);
  assert.equal(({} as Record<string, unknown>).__proto__, Object.prototype);
});

test("caption is sanitised, not rejected", () => {
  const r = timelineSchema.parse({ steps: [step([], "Hi‮there​")] });
  assert.equal(r.steps[0]!.caption, "Hithere");
});

const many = <T>(n: number, f: () => T) => Array.from({ length: n }, f);
for (const [name, input] of [
  ["31 steps", { steps: many(31, () => step()) }],
  ["0 steps", { steps: [] }],
  ["durationMs 299", { steps: [{ ...step(), durationMs: 299 }] }],
  ["durationMs 4001", { steps: [{ ...step(), durationMs: 4001 }] }],
  ["fractional durationMs", { steps: [{ ...step(), durationMs: 500.5 }] }],
  ["21 set items", { steps: [step(many(21, () => ({ id: "a", prop: "x", value: 1 })))] }],
  ["bad id", { steps: [step([{ id: "Bad-Id", prop: "x", value: 1 }])] }],
  ["empty caption after sanitising", { steps: [step([], "‮")] }],
  ["unknown key on timeline", { steps: [step()], loop: true }],
  ["unknown key on step", { steps: [{ ...step(), easing: "in" }] }],
  ["unknown key on set item", { steps: [step([{ id: "a", prop: "x", value: 1, ease: 1 } as never])] }],
] as const) {
  test(`rejects ${name}`, () => assert.equal(timelineSchema.safeParse(input).success, false));
}
