// Pure mobile-budget logic for scene3d: caps, poster decision, touch gesture decision, live-context counter. No DOM, React or WebGL.
import { parts, type Primitive } from "./model.ts";

export const MAX_OBJECTS = 60;
export const MAX_DRAW_CALLS = 100;
export const MAX_TRIANGLES = 100_000;
export const MAX_DPR = 2;

// shortcut: triangle counts are derived from the segment args in model.parts() by formula, not measured from three; recheck if parts() changes.
const triangles = (g: ReturnType<typeof parts>[number]): number => {
  const a = g.args;
  switch (g.geo) {
    case "sphere": return a[1]! * a[2]! * 2;
    case "box": return 12;
    case "cylinder": return a[3]! * 4; // sides + two caps
    case "cone": return a[2]! * 2; // sides + base
    case "torus": return a[2]! * a[3]! * 2;
    case "plane": return 2;
  }
};

export type BudgetCheck = { ok: boolean; objects: number; drawCalls: number; triangles: number; reason?: string };

/** Counts objects, draw calls (one per mesh part) and triangles against the caps. */
export function checkBudget(prims: readonly Pick<Primitive, "kind" | "size">[]): BudgetCheck {
  let drawCalls = 0, tris = 0;
  for (const p of prims) for (const g of parts(p.kind, p.size)) { drawCalls++; tris += triangles(g); }
  const r: BudgetCheck = { ok: true, objects: prims.length, drawCalls, triangles: tris };
  if (prims.length > MAX_OBJECTS) { r.ok = false; r.reason = `more than ${MAX_OBJECTS} objects`; }
  else if (drawCalls > MAX_DRAW_CALLS) { r.ok = false; r.reason = `more than ${MAX_DRAW_CALLS} draw calls`; }
  else if (tris > MAX_TRIANGLES) { r.ok = false; r.reason = `more than ${MAX_TRIANGLES} triangles`; }
  return r;
}

/** Save-Data or a slow connection (2g/3g) starts as a poster and loads on tap. */
export const shouldStartAsPoster = (c: { saveData?: boolean; effectiveType?: string } | null | undefined): boolean =>
  !!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g");

/** wait: not enough movement yet; orbit: mostly horizontal; scroll: mostly vertical, leave it to the page. */
export function touchGesture(dx: number, dy: number, slop = 6): "wait" | "orbit" | "scroll" {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return "wait";
  return ax > ay ? "orbit" : "scroll";
}

/** Counts live WebGL contexts; acquire() fails once `max` are held. */
export function createContextCounter(max = 1) {
  let n = 0;
  return {
    acquire: () => (n < max ? (n++, true) : false),
    release: () => { if (n > 0) n--; },
    get count() { return n; },
  };
}

/** One live WebGL context per page. */
export const liveContexts = createContextCounter(1);
