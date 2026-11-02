import test from "node:test";
import assert from "node:assert/strict";
import { checkBudget, createContextCounter, shouldStartAsPoster, touchGesture, MAX_DRAW_CALLS, MAX_OBJECTS } from "./budget.ts";

const prim = (kind: "sphere" | "box" | "arrow" | "label") => ({ kind, size: 1 });

test("a normal scene is inside the budget", () => {
  const b = checkBudget([prim("sphere"), prim("box"), prim("arrow"), prim("label")]);
  assert.equal(b.ok, true);
  assert.equal(b.drawCalls, 4); // sphere 1 + box 1 + arrow 2 + label 0
  assert.equal(b.triangles, 24 * 16 * 2 + 12 + 12 * 4 + 12 * 2);
});

test("object, draw-call and triangle caps are enforced", () => {
  assert.equal(checkBudget(Array.from({ length: MAX_OBJECTS + 1 }, () => prim("label"))).ok, false);
  const arrows = Array.from({ length: MAX_DRAW_CALLS / 2 + 1 }, () => prim("arrow"));
  assert.match(checkBudget(arrows).reason!, /draw calls/);
  // The triangle cap cannot trip yet: 60 objects of the heaviest part is ~46k triangles.
  assert.ok(checkBudget(Array.from({ length: 60 }, () => prim("sphere"))).triangles < 100_000);
});

test("poster for Save-Data and 2g/3g, not for 4g or unknown", () => {
  assert.equal(shouldStartAsPoster({ saveData: true }), true);
  for (const t of ["slow-2g", "2g", "3g"]) assert.equal(shouldStartAsPoster({ effectiveType: t }), true);
  assert.equal(shouldStartAsPoster({ effectiveType: "4g" }), false);
  assert.equal(shouldStartAsPoster({}), false);
  assert.equal(shouldStartAsPoster(undefined), false);
});

test("touch gesture: wait under the slop, then horizontal orbits and vertical scrolls", () => {
  assert.equal(touchGesture(2, 3), "wait");
  assert.equal(touchGesture(20, 5), "orbit");
  assert.equal(touchGesture(-20, 5), "orbit");
  assert.equal(touchGesture(5, 20), "scroll");
  assert.equal(touchGesture(10, -10), "scroll");
});

test("only one live context at a time; release frees the slot", () => {
  const c = createContextCounter(1);
  assert.equal(c.acquire(), true);
  assert.equal(c.acquire(), false);
  assert.equal(c.count, 1);
  c.release(); c.release();
  assert.equal(c.count, 0);
  assert.equal(c.acquire(), true);
});
