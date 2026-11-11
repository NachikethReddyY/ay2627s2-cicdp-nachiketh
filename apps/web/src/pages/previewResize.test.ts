import assert from "node:assert/strict";
import test from "node:test";
import { resizeRect, type PreviewRect } from "./previewResize.ts";

const start: PreviewRect = { left: 200, top: 150, width: 500, height: 400 };
const bounds = { width: 1200, height: 800 };

test("east and south edges move the far side and keep the origin", () => {
  assert.deepEqual(resizeRect(start, "e", 50, 0, bounds), { left: 200, top: 150, width: 550, height: 400 });
  assert.deepEqual(resizeRect(start, "s", 0, 30, bounds), { left: 200, top: 150, width: 500, height: 430 });
});

test("west and north edges keep the opposite edge fixed", () => {
  const west = resizeRect(start, "w", -40, 0, bounds);
  assert.deepEqual(west, { left: 160, top: 150, width: 540, height: 400 });
  assert.equal(west.left + west.width, start.left + start.width);
  const north = resizeRect(start, "n", 0, -20, bounds);
  assert.deepEqual(north, { left: 200, top: 130, width: 500, height: 420 });
  assert.equal(north.top + north.height, start.top + start.height);
});

test("corners change both axes", () => {
  assert.deepEqual(resizeRect(start, "se", 10, 20, bounds), { left: 200, top: 150, width: 510, height: 420 });
  assert.deepEqual(resizeRect(start, "nw", -10, -20, bounds), { left: 190, top: 130, width: 510, height: 420 });
  assert.deepEqual(resizeRect(start, "ne", 10, -20, bounds), { left: 200, top: 130, width: 510, height: 420 });
  assert.deepEqual(resizeRect(start, "sw", -10, 20, bounds), { left: 190, top: 150, width: 510, height: 420 });
});

test("size clamps to the minimum on every edge", () => {
  assert.deepEqual(resizeRect(start, "e", -900, 0, bounds).width, 300);
  assert.deepEqual(resizeRect(start, "w", 900, 0, bounds), { left: 400, top: 150, width: 300, height: 400 });
  assert.equal(resizeRect(start, "s", 0, -900, bounds).height, 240);
  assert.deepEqual(resizeRect(start, "n", 0, 900, bounds), { left: 200, top: 310, width: 500, height: 240 });
});

test("size and position clamp to the viewport with an 8px margin", () => {
  assert.equal(resizeRect(start, "e", 5000, 0, bounds).width, 1200 - 8 - 200);
  assert.equal(resizeRect(start, "s", 0, 5000, bounds).height, 800 - 8 - 150);
  assert.equal(resizeRect(start, "w", -5000, 0, bounds).left, 8);
  assert.equal(resizeRect(start, "n", 0, -5000, bounds).top, 8);
});
