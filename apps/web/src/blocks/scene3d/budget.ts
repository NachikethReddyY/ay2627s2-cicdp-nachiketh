import { parts, type Primitive } from "./model.ts";

export const MAX_OBJECTS = 60;
export const MAX_DRAW_CALLS = 100;
const MAX_TRIANGLES = 100_000;
export const MAX_DPR = 2;

const triangles = (g: ReturnType<typeof parts>[number]): number => {
  const a = g.args;
  switch (g.geo) {
    case "sphere": return a[1] * a[2] * 2;
    case "box": return 12;
    case "cylinder": return a[3] * 4;
    case "cone": return a[2] * 2;
    case "torus": return a[2] * a[3] * 2;
    case "plane": return 2;
  }
};

export type BudgetCheck = { ok: boolean; objects: number; drawCalls: number; triangles: number; reason?: string };

export function checkBudget(prims: readonly Pick<Primitive, "kind" | "size">[]): BudgetCheck {
  let drawCalls = 0, tris = 0;
  for (const p of prims) for (const g of parts(p.kind, p.size)) { drawCalls++; tris += triangles(g); }
  const r: BudgetCheck = { ok: true, objects: prims.length, drawCalls, triangles: tris };
  if (prims.length > MAX_OBJECTS) { r.ok = false; r.reason = `more than ${MAX_OBJECTS} objects`; }
  else if (drawCalls > MAX_DRAW_CALLS) { r.ok = false; r.reason = `more than ${MAX_DRAW_CALLS} draw calls`; }
  else if (tris > MAX_TRIANGLES) { r.ok = false; r.reason = `more than ${MAX_TRIANGLES} triangles`; }
  return r;
}

export const shouldStartAsPoster = (c: { saveData?: boolean; effectiveType?: string } | null | undefined): boolean =>
  !!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g" || c.effectiveType === "3g");

export function touchGesture(dx: number, dy: number, slop = 6): "wait" | "orbit" | "scroll" {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return "wait";
  return ax > ay ? "orbit" : "scroll";
}

export function createContextCounter(max = 1) {
  let n = 0;
  return {
    acquire: () => (n < max ? (n++, true) : false),
    release: () => { if (n > 0) n--; },
    get count() { return n; },
  };
}

export const liveContexts = createContextCounter(1);
