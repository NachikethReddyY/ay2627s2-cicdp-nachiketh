import test from "node:test";
import assert from "node:assert/strict";
import { bounceTimeline, bounceY, simulateBounce, timelineSchema, stateAt } from "@learnquest/ui-catalog";
import { bodyState, resolve, segment, type StageShape } from "./model.ts";

const ball: StageShape = { id: "ball", kind: "circle", x: 10, y: 20, r: 5, fill: "sun" };
const tl = timelineSchema.parse({
  steps: [
    { caption: "a", durationMs: 500, set: [] },
    { caption: "b", durationMs: 500, set: [{ id: "ball", prop: "x", value: 60 }, { id: "ball", prop: "fill", value: "blue" }, { id: "ball", prop: "opacity", value: 0.5 }, { id: "ball", prop: "r", value: 9 }] },
  ],
});

test("without state a shape renders as authored", () => {
  const r = resolve(ball, undefined);
  assert.deepEqual([r.dx, r.dy, r.opacity, r.r, r.fill], [0, 0, 1, 5, "var(--color-sun)"]);
  assert.equal(resolve(ball, stateAt(tl, 0)).dx, 0);
});

test("timeline state offsets position and overrides colour, opacity and size", () => {
  const r = resolve(ball, stateAt(tl, 1));
  assert.deepEqual([r.dx, r.dy, r.opacity, r.r, r.fill], [50, 0, 0.5, 9, "var(--color-blue)"]);
});

test("bad state values fall back instead of leaking into attributes", () => {
  const r = resolve(ball, { ball: { x: "javascript:1", fill: "red);x", opacity: 7 } } as never);
  assert.deepEqual([r.dx, r.fill, r.opacity], [0, "var(--color-sun)", 1]);
});

test("label sits at the centre of rects and lines", () => {
  assert.deepEqual(resolve({ id: "b", kind: "rect", x: 10, y: 10, w: 20, h: 10 }, undefined).label, { x: 20, y: 15 });
  assert.deepEqual(resolve({ id: "l", kind: "line", x: 0, y: 0, x2: 10, y2: 20 }, undefined).label, { x: 5, y: 10 });
});

test("physics segments animate only the next step and snap for jumps or reduced motion", () => {
  const poses = [0, 0.5, 1.25, 2];
  assert.deepEqual(segment(0, 1, false, poses), [0, 0.5]);
  assert.equal(segment(1, 0, false, poses), null);
  assert.equal(segment(0, 2, false, poses), null);
  assert.equal(segment(0, 1, true, poses), null);
});

test("bodyState resolves to deterministic simulator poses when scrubbing", () => {
  const b = simulateBounce({ kind: "circle", y: 20, r: 6 }, { kind: "bounce", floor: 80, restitution: 0.75 });
  const { poses } = bounceTimeline(b, { kind: "bounce", floor: 80, restitution: 0.75 });
  const at = (i: number) => resolve(ball, bodyState("ball", bounceY(b, poses[i]!))).dy;
  const expected = at(2);
  assert.equal(at(2), expected);
  assert.equal(resolve(ball, bodyState("ball", bounceY(b, poses[2]!))).dy, expected);
  assert.equal(resolve(ball, bodyState("ball", 37)).dy, 17);
});
