import { z } from "zod";
import { id } from "./caps.ts";
import { text } from "./sanitize.ts";

export const MAX_STEPS = 30;
export const MAX_SET = 20;
const MAX_CAPTION = 200;
export const MIN_STEP_MS = 300;
export const MAX_STEP_MS = 4000;
/** Motion curves a step may use (GSAP ease names). */
export const EASES = ["none", "power2.in", "power2.out", "power2.inOut", "back.out(1.6)", "bounce.out", "elastic.out(1, 0.5)"] as const;

// `prop` uses the id pattern too: state keys stay short snake_case names, never free text.
const setSchema = z.strictObject({
  id: id(),
  prop: id(),
  value: z.union([text(MAX_CAPTION), z.number(), z.boolean()]),
});

const stepSchema = z.strictObject({
  caption: text(MAX_CAPTION),
  durationMs: z.int().min(MIN_STEP_MS).max(MAX_STEP_MS),
  ease: z.enum(EASES).optional(),
  set: z.array(setSchema).max(MAX_SET),
});

// Shared by block modules that animate; not a block itself, so it is not in BLOCKS.
// Reduced-motion handling (skip transitions, no autoplay) is owned by the UI layer, not this reducer.
export const timelineSchema = z.strictObject({
  steps: z.array(stepSchema).min(1).max(MAX_STEPS),
  autoplay: z.boolean().optional(),
});

export type Timeline = z.infer<typeof timelineSchema>;
export type TimelineValue = string | number | boolean;
// element id -> prop -> value. Null-prototype records, so ids like "__proto__" stay plain keys.
export type TimelineState = Record<string, Record<string, TimelineValue>>;

export const stepCount = (t: Timeline): number => t.steps.length;

// Any number (NaN, fractions, out of range) maps to a valid step index.
export const clampStep = (t: Timeline, i: number): number =>
  Math.min(Math.max(Math.trunc(i) || 0, 0), t.steps.length - 1);

// Applies steps 0..i in order, so later steps overwrite earlier ones for the same (id, prop).
export const stateAt = (t: Timeline, i: number): TimelineState => {
  const state: TimelineState = Object.create(null);
  for (const step of t.steps.slice(0, clampStep(t, i) + 1)) {
    for (const { id, prop, value } of step.set) {
      (state[id] ??= Object.create(null))[prop] = value;
    }
  }
  return state;
};
