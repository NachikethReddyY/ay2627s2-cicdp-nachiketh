import { test } from "node:test";
import assert from "node:assert/strict";
import { isToggleKey, loadPanel, panelReducer, savePanel } from "./usePanel.ts";

test("toggle, open and close; opening marks everOpened", () => {
  let s = panelReducer({ open: false, height: 240, everOpened: false }, { type: "toggle" });
  assert.deepEqual(s, { open: true, height: 240, everOpened: true });
  s = panelReducer(s, { type: "close" }); assert.deepEqual(s, { open: false, height: 240, everOpened: true });
});

test("resize clamps to 120 px and 70 % of the container", () => {
  const r = (px: number, container: number) => panelReducer({ open: true, height: 240, everOpened: true }, { type: "resize", px, container }).height;
  assert.equal(r(50, 1000), 120); assert.equal(r(900, 1000), 700); assert.equal(r(300, 1000), 300);
  assert.equal(r(300, 100), 120, "a tiny window still allows the minimum");
});

test("restores from lq.terminal; first load with nothing stored is closed at 240", () => {
  assert.deepEqual(loadPanel({ getItem: () => null }), { open: false, height: 240, everOpened: false });
  assert.deepEqual(loadPanel({ getItem: (k) => (k === "lq.terminal" ? '{"open":true,"height":300}' : null) }), { open: true, height: 300, everOpened: true });
});

test("a corrupted or out-of-range stored value falls back safely", () => {   // Review Focus 5
  for (const raw of ["not json", '{"open":"yes","height":300}', '{"open":true,"height":-5}', '{"open":true,"height":"big"}', "null", "[]"]) {
    const s = loadPanel({ getItem: () => raw });
    assert.equal(typeof s.open, "boolean", raw);
    assert.ok(s.height >= 120 && Number.isFinite(s.height), raw);
  }
});

test("a throwing localStorage falls back to closed and 240 and save does not throw", () => {
  assert.deepEqual(loadPanel({ getItem: () => { throw new Error("blocked"); } }), { open: false, height: 240, everOpened: false });
  assert.doesNotThrow(() => savePanel({ setItem: () => { throw new Error("quota"); } }, { open: true, height: 300, everOpened: true }));
  assert.doesNotThrow(() => savePanel(undefined, { open: true, height: 300, everOpened: true }));
});

test("Ctrl+` toggles on any keyboard layout; other modifiers do not", () => {
  const k = (o: Partial<KeyboardEvent>) => isToggleKey({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: "", ...o });
  assert.equal(k({ ctrlKey: true, code: "Backquote" }), true);
  assert.equal(k({ ctrlKey: true, code: "Backquote", shiftKey: true }), false);
  assert.equal(k({ metaKey: true, code: "Backquote" }), false);
  assert.equal(k({ ctrlKey: true, code: "KeyC" }), false);
});
