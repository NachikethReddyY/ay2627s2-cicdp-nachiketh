import { z } from "zod";
import type { GameKind } from "./shell.ts";

export const MAX_TARGET_X = 100;
export const MAX_LAUNCH_SPEED = 40;
const G = 9.8;
const DT = 1 / 60;
export const MIN_ANGLE = 5;
export const MAX_ANGLE = 85;

export type PhysicsProps = { kind: "physics"; target: { x: number; width: number }; maxSpeed: number };

const physicsSchema = z.strictObject({
  kind: z.literal("physics"),
  /** Where the target zone sits on the ground, in metres from the launcher, and how wide it is. */
  target: z.strictObject({ x: z.int().min(2).max(MAX_TARGET_X), width: z.int().min(1).max(20) }),
  /** Top of the speed slider in m/s; the angle slider is fixed at MIN_ANGLE to MAX_ANGLE degrees. */
  maxSpeed: z.int().min(5).max(MAX_LAUNCH_SPEED),
});

export type Launch = { path: { x: number; y: number }[]; landX: number; hit: boolean };

/**
 * Fixed-step projectile (semi-implicit Euler, no random input), shared by the save check and the browser
 * so both reach the same outcome. Pure arithmetic: no engine, no clock, nothing a learner wrote is run.
 */
export function simulateLaunch(p: Pick<PhysicsProps, "target">, angle: number, speed: number): Launch {
  const r = (angle * Math.PI) / 180;
  let vx = speed * Math.cos(r);
  let vy = speed * Math.sin(r);
  let x = 0;
  let y = 0;
  const path = [{ x, y }];
  while (path.length < 10_000) {
    vy -= G * DT;
    const ny = y + vy * DT;
    const nx = x + vx * DT;
    if (ny <= 0) {
      // Interpolate the last step so the landing point does not depend on the step size.
      x += (nx - x) * (y / (y - ny));
      path.push({ x, y: 0 });
      break;
    }
    x = nx;
    y = ny;
    path.push({ x, y });
  }
  const landX = Math.round(x * 1000) / 1000;
  return { path, landX, hit: Math.abs(landX - p.target.x) <= p.target.width / 2 };
}

/** True when some whole-number angle and speed on the sliders lands in the target. */
export function reachable(p: PhysicsProps): boolean {
  for (let a = MIN_ANGLE; a <= MAX_ANGLE; a++) for (let s = 1; s <= p.maxSpeed; s++) if (simulateLaunch(p, a, s).hit) return true;
  return false;
}

/** The target must be hittable with the sliders as they are, or the game cannot be won. */
export const physicsKind: GameKind<PhysicsProps> = {
  schema: physicsSchema,
  check: (p) => (reachable(p) ? [] : [{ path: "target", message: "no angle and speed on the sliders reaches the target" }]),
  describe: (p) => `Launch a ball with the angle and speed sliders to land it in a ${p.target.width} metre target ${p.target.x} metres away.`,
};
