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

// Storage stub that answers only for the given keys; other keys read as missing.
const store = (items: Record<string, string>) => ({ getItem: (k: string) => items[k] ?? null });

test("loadLayout returns the defaults for missing or unusable storage", () => {
  for (const raw of [null, "not json", "[]", "null", '{"leftW":"big"}', '{"leftW":-5}']) {
    assert.deepEqual(loadLayout(store({ "lq.workbench": raw as string })), DEFAULT_LAYOUT, String(raw));
  }
  assert.deepEqual(loadLayout(store({})), DEFAULT_LAYOUT);
});

test("loadLayout keeps valid fields and defaults the rest", () => {
  const raw = '{"leftW":300,"utilW":"wide","showLeft":false,"showUtil":"yes","leftView":"problems","utilTab":"nope"}';
  assert.deepEqual(loadLayout(store({ "lq.workbench": raw, "lq.theme": "dark" })), {
    ...DEFAULT_LAYOUT,
    leftW: 300,
    showLeft: false,
    leftView: "problems",
    theme: "dark",
  });
});

test("theme is read from lq.theme; a bad lq.theme falls back to system and other fields still load", () => {
  assert.equal(loadLayout(store({ "lq.theme": "neon" })).theme, "system");
  assert.equal(loadLayout(store({ "lq.theme": "" })).theme, "system");
  assert.equal(loadLayout(store({ "lq.theme": "light" })).theme, "light");
  const s = loadLayout(store({ "lq.theme": "neon", "lq.workbench": '{"leftW":300}' }));
  assert.equal(s.theme, "system");
  assert.equal(s.leftW, 300);
});

test("a theme in the old lq.workbench blob is ignored", () => {
  assert.equal(loadLayout(store({ "lq.workbench": '{"theme":"dark"}' })).theme, "system");
});

test("loadLayout tolerates a throwing storage", () => {
  const throwing = { getItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(loadLayout(throwing), DEFAULT_LAYOUT);
});

test("saveLayout writes the other fields to lq.workbench and theme to lq.theme", () => {
  const items: Record<string, string> = {};
  const s: Layout = { ...DEFAULT_LAYOUT, leftW: 300, theme: "dark" };
  saveLayout({ setItem: (k, v) => { items[k] = v; } }, s);
  const blob = JSON.parse(items["lq.workbench"] ?? "null");
  assert.equal("theme" in blob, false, "lq.workbench must not hold the theme");
  assert.equal(blob.leftW, 300);
  assert.equal(items["lq.theme"], "dark");
});

test("theme round-trips through lq.theme", () => {
  const items: Record<string, string> = {};
  const s: Layout = { ...DEFAULT_LAYOUT, leftW: 250, theme: "light" };
  saveLayout({ setItem: (k, v) => { items[k] = v; } }, s);
  assert.deepEqual(loadLayout(store(items)), s);
});

test("saveLayout tolerates a throwing storage", () => {
  assert.doesNotThrow(() => saveLayout({ setItem: () => { throw new Error("quota"); } }, DEFAULT_LAYOUT));
  assert.doesNotThrow(() => saveLayout(undefined, DEFAULT_LAYOUT));
});

test("resize with a NaN px is ignored", () => {
  assert.deepEqual(layoutReducer(DEFAULT_LAYOUT, { type: "resizeLeft", px: NaN, container: BIG }), DEFAULT_LAYOUT);
  assert.deepEqual(layoutReducer(DEFAULT_LAYOUT, { type: "resizeUtil", px: NaN, container: BIG }), DEFAULT_LAYOUT);
});

test("clampLayout with both panels hidden leaves the widths unchanged", () => {
  const s = clampLayout({ ...DEFAULT_LAYOUT, showLeft: false, showUtil: false, leftW: 520, utilW: 420 }, 500);
  assert.equal(s.leftW, 520);
  assert.equal(s.utilW, 420);
});
