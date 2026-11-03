import type { Timeline } from "../../core/timeline.ts";

export const G_UNITS = 490;
export const REST_HEIGHT = 0.25;
export const MAX_HOPS = 30;
export const MAX_SIM_S = 15;
export const CAPTIONED_HOPS = 4;

export type BounceShape = { kind: "circle"; y: number; r: number };
export type BouncePhysics = { kind: "bounce"; floor: number; restitution: number; autoplay?: boolean };
export type BounceHop = { at: number; speed: number; height: number };
export type Bounce = { y0: number; rest: number; t0: number; hops: BounceHop[]; restAt: number };

export function simulateBounce(shape: BounceShape, physics: BouncePhysics): Bounce {
  const rest = physics.floor - shape.r;
  const y0 = shape.y;
  const drop = rest - y0;
  const t0 = Math.sqrt((2 * drop) / G_UNITS);
  const impactSpeed = G_UNITS * t0;
  const hops: BounceHop[] = [];
  let at = t0;
  for (let n = 1; n <= MAX_HOPS && at <= MAX_SIM_S; n++) {
    const speed = impactSpeed * physics.restitution ** n;
    const height = (speed * speed) / (2 * G_UNITS);
    if (height < REST_HEIGHT) break;
    hops.push({ at, speed, height });
    at += (2 * speed) / G_UNITS;
  }
  return { y0, rest, t0, hops, restAt: at };
}

export function bounceY(bounce: Bounce, time: number): number {
  const t = Math.max(0, Math.min(time, bounce.restAt));
  if (t < bounce.t0) return bounce.y0 + 0.5 * G_UNITS * t * t;
  for (const hop of bounce.hops) {
    const duration = (2 * hop.speed) / G_UNITS;
    if (t <= hop.at + duration) {
      const s = t - hop.at;
      return bounce.rest - (hop.speed * s - 0.5 * G_UNITS * s * s);
    }
  }
  return bounce.rest;
}

export function bounceTimeline(bounce: Bounce, physics: BouncePhysics): { timeline: Timeline; poses: number[] } {
  const visible = bounce.hops.filter((hop) => hop.height >= bounce.hops[0]!.height * 0.05).slice(0, CAPTIONED_HOPS);
  const poses = [0, ...visible.map((hop) => hop.at + hop.speed / G_UNITS), bounce.restAt];
  const steps = poses.map((pose, i) => {
    const durationMs = Math.max(1, Math.round(((poses[i + 1] ?? pose + 0.3) - pose) * 1000));
    if (i === 0) return { caption: "Held still: all of its energy is stored as height (potential energy).", durationMs, set: [] };
    if (i === poses.length - 1) return { caption: "Smaller and smaller bounces, until the ball rests on the ground.", durationMs, set: [] };
    const hop = visible[i - 1]!;
    const percent = (100 * hop.height) / (bounce.rest - bounce.y0);
    const caption = i === 1
      ? `It falls and speeds up as height turns into speed (kinetic energy), hits the ground, and rises to ${percent.toFixed(1)}% of the drop.`
      : `Bounce ${i}: each hit keeps about ${(physics.restitution ** 2 * 100).toFixed(0)}% of the energy (e²), so it only reaches ${percent.toFixed(1)}% of the starting height.`;
    return { caption, durationMs, set: [] };
  });
  return { timeline: { steps, autoplay: physics.autoplay }, poses };
}
