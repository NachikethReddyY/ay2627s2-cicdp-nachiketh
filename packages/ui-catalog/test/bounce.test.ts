import { test } from "node:test";
import assert from "node:assert/strict";
import { bounceTimeline, bounceY, G_UNITS, MAX_HOPS, MAX_SIM_S, REST_HEIGHT, simulateBounce } from "../src/index.ts";

const shape = { kind: "circle" as const, y: 20, r: 6 };
const physics = { kind: "bounce" as const, floor: 80, restitution: 0.75 };

test("bounce heights decay by restitution squared and energy never increases", () => {
  const b = simulateBounce(shape, physics);
  assert.ok(b.hops.length > 1);
  for (let i = 1; i < b.hops.length; i++) {
    assert.ok(b.hops[i]!.height < b.hops[i - 1]!.height);
    assert.ok(Math.abs(b.hops[i]!.height / b.hops[i - 1]!.height - physics.restitution ** 2) < 1e-12);
  }
});

test("the ball rests below threshold within the simulation caps", () => {
  const b = simulateBounce(shape, physics);
  assert.ok(b.hops.at(-1)!.height >= REST_HEIGHT);
  const next = b.hops.at(-1)!.height * physics.restitution ** 2;
  assert.ok(next < REST_HEIGHT);
  assert.equal(bounceY(b, b.restAt + 1), b.rest);
  const worst = simulateBounce({ kind: "circle", y: 0, r: 0 }, { ...physics, floor: 100, restitution: 0.9 });
  assert.ok(worst.hops.length <= MAX_HOPS);
  assert.ok(worst.restAt <= MAX_SIM_S);
});

test("simulation and arbitrary-time poses are deterministic", () => {
  const a = simulateBounce(shape, physics);
  assert.deepEqual(simulateBounce(shape, physics), a);
  const times = [0, 0.1, 0.5, 1, 2, a.restAt];
  const expected = times.map((t) => bounceY(a, t));
  assert.deepEqual([...times].reverse().map((t) => bounceY(a, t)).reverse(), expected);
});

test("energy is conserved during a hop and the derived timeline has ordered positive poses", () => {
  const b = simulateBounce(shape, physics);
  const first = b.hops[0]!;
  const apex = first.at + first.speed / G_UNITS;
  const energy = (t: number) => {
    const dt = 0.001;
    const velocity = (bounceY(b, t + dt) - bounceY(b, t - dt)) / (2 * dt);
    return 0.5 * velocity ** 2 + G_UNITS * (b.rest - bounceY(b, t));
  };
  assert.ok(Math.abs(energy(first.at + 0.05) / energy(apex) - 1) < 0.01);
  const { timeline, poses } = bounceTimeline(b, physics);
  assert.equal(timeline.steps.length, poses.length);
  assert.match(timeline.steps[0]!.caption, /Held still/);
  assert.ok(poses.every((pose, i) => i === 0 || pose > poses[i - 1]!));
  assert.ok(timeline.steps.every((step) => step.durationMs > 0));
  assert.match(timeline.steps[1]!.caption, /%/);
});
