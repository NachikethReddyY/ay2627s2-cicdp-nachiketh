import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LAYOUT, clampLayout, layoutReducer, loadLayout, saveLayout } from "./layout.ts";
import type { Layout } from "./layout.ts";

const BIG = 2000;

test("toggleLeft and toggleUtil flip only their own flag", () => {
  let s = layoutReducer(DEFAULT_LAYOUT, { type: "toggleLeft" });
  assert.deepEqual(s, { ...DEFAULT_LAYOUT, showLeft: false });
  s = layoutReducer(s, { type: "toggleUtil" });
  assert.deepEqual(s, { ...DEFAULT_LAYOUT, showLeft: false, showUtil: false });
  s = layoutReducer(s, { type: "toggleLeft" });
  assert.deepEqual(s, { ...DEFAULT_LAYOUT, showUtil: false });
});

test("resizeLeft clamps to 180 and 520", () => {
  const r = (px: number, container = BIG) => layoutReducer(DEFAULT_LAYOUT, { type: "resizeLeft", px, container }).leftW;
  assert.equal(r(50), 180);
  assert.equal(r(900), 520);
  assert.equal(r(300), 300);
});

test("resizeUtil clamps to 200 and 420", () => {
  const r = (px: number, container = BIG) => layoutReducer(DEFAULT_LAYOUT, { type: "resizeUtil", px, container }).utilW;
  assert.equal(r(50), 200);
  assert.equal(r(900), 420);
  assert.equal(r(250), 250);
});

test("resize leaves the editor its 360 px", () => {
  // 1000 - utilW 320 - 360 = 320, so the navigator cannot grow past 320.
  assert.equal(layoutReducer(DEFAULT_LAYOUT, { type: "resizeLeft", px: 520, container: 1000 }).leftW, 320);
  // 900 - leftW 232 - 360 = 308, so the utility area cannot grow past 308.
  assert.equal(layoutReducer(DEFAULT_LAYOUT, { type: "resizeUtil", px: 420, container: 900 }).utilW, 308);
  // A window too small for the minimum still stops at the minimum.
  assert.equal(layoutReducer(DEFAULT_LAYOUT, { type: "resizeLeft", px: 520, container: 400 }).leftW, 180);
});

test("leftView, utilTab and theme actions set their field", () => {
  assert.equal(layoutReducer(DEFAULT_LAYOUT, { type: "leftView", view: "problems" }).leftView, "problems");
  assert.equal(layoutReducer(DEFAULT_LAYOUT, { type: "utilTab", tab: "docs" }).utilTab, "docs");
  assert.equal(layoutReducer(DEFAULT_LAYOUT, { type: "theme", theme: "dark" }).theme, "dark");
});

test("clampLayout shrinks utility before navigator to keep 360 px for the editor", () => {
  const s = clampLayout({ ...DEFAULT_LAYOUT, leftW: 520, utilW: 420 }, 1100);
  assert.equal(1100 - s.leftW - s.utilW >= 360, true);
  assert.equal(s.leftW, 520, "navigator keeps its width");
  assert.equal(s.utilW, 220, "utility shrinks first");
});

test("clampLayout shrinks the navigator once the utility area is at its minimum", () => {
  const s = clampLayout({ ...DEFAULT_LAYOUT, leftW: 520, utilW: 420 }, 900);
  assert.equal(s.utilW, 200);
  assert.equal(s.leftW, 340);
  assert.equal(900 - s.leftW - s.utilW >= 360, true);
});

test("clampLayout returns the minimums when the window is too small", () => {
  const s = clampLayout({ ...DEFAULT_LAYOUT, leftW: 520, utilW: 420 }, 500);
  assert.equal(s.leftW, 180);
  assert.equal(s.utilW, 200);
});

test("clampLayout pulls out-of-range widths into the design ranges", () => {
  const s = clampLayout({ ...DEFAULT_LAYOUT, leftW: 10, utilW: 9000 }, BIG);
  assert.equal(s.leftW, 180);
  assert.equal(s.utilW, 420);
});

test("clampLayout with a hidden panel only protects the visible one", () => {
  const s = clampLayout({ ...DEFAULT_LAYOUT, showLeft: false, utilW: 420 }, 500);
  assert.equal(s.utilW, 200, "500 - 360 = 140, so the utility area drops to its minimum");
  assert.equal(s.leftW, DEFAULT_LAYOUT.leftW, "the hidden navigator is not touched");
});

test("loadLayout returns the defaults for missing or unusable storage", () => {
  for (const raw of [null, "not json", "[]", "null", '{"leftW":"big"}', '{"leftW":-5}', '{"theme":"neon"}']) {
    assert.deepEqual(loadLayout({ getItem: () => raw }), DEFAULT_LAYOUT, String(raw));
  }
});

test("loadLayout keeps valid fields and defaults the rest", () => {
  const raw = '{"leftW":300,"utilW":"wide","showLeft":false,"showUtil":"yes","leftView":"problems","utilTab":"nope","theme":"dark"}';
  assert.deepEqual(loadLayout({ getItem: () => raw }), {
    ...DEFAULT_LAYOUT,
    leftW: 300,
    showLeft: false,
    leftView: "problems",
    theme: "dark",
  });
});

test("loadLayout tolerates a throwing storage", () => {
  assert.deepEqual(loadLayout({ getItem: () => { throw new Error("blocked"); } }), DEFAULT_LAYOUT);
});

test("saveLayout writes under lq.workbench and tolerates a throwing storage", () => {
  const written: Array<[string, string]> = [];
  const s: Layout = { ...DEFAULT_LAYOUT, leftW: 300 };
  saveLayout({ setItem: (k, v) => { written.push([k, v]); } }, s);
  assert.equal(written[0]?.[0], "lq.workbench");
  assert.deepEqual(JSON.parse(written[0]?.[1] ?? "null"), s);
  assert.doesNotThrow(() => saveLayout({ setItem: () => { throw new Error("quota"); } }, s));
});
