import test from "node:test";
import assert from "node:assert/strict";
import { timelineSchema, stateAt, type Scene3dProps } from "@learnquest/ui-catalog";
import { budget, cameraPreset, lightPreset, orbitPosition, parts, resolve, type Primitive } from "./model.ts";

const nuc: Primitive = { id: "nuc", kind: "sphere", position: [1, 2, 3], size: 1, color: "pink", material: "matte", rotation: [90, 0, 0] };
const tl = timelineSchema.parse({
  steps: [
    { caption: "a", durationMs: 500, set: [] },
    { caption: "b", durationMs: 500, set: [{ id: "nuc", prop: "position", value: "0,5,-1" }, { id: "nuc", prop: "color", value: "blue" }, { id: "nuc", prop: "opacity", value: 0.25 }, { id: "nuc", prop: "rotation", value: "0,180,0" }] },
  ],
});

test("without state a primitive renders as authored (rotation in radians)", () => {
  const r = resolve(nuc, undefined);
  assert.deepEqual(r.position, [1, 2, 3]);
  assert.ok(Math.abs(r.rotation[0] - Math.PI / 2) < 1e-9);
  assert.equal(r.color, "#ff8fb1");
  assert.equal(r.opacity, 1);
});

test("timeline state overrides position, rotation, colour and opacity", () => {
  assert.deepEqual(resolve(nuc, stateAt(tl, 0)).position, [1, 2, 3]);
  const r = resolve(nuc, stateAt(tl, 1));
  assert.deepEqual(r.position, [0, 5, -1]);
  assert.ok(Math.abs(r.rotation[1] - Math.PI) < 1e-9);
  assert.equal(r.color, "#3b5bff");
  assert.equal(r.opacity, 0.25);
});

test("malformed state values fall back to the authored ones", () => {
  const r = resolve(nuc, { nuc: { position: "99,0,0", color: "red", opacity: 7 } });
  assert.deepEqual(r.position, [1, 2, 3]);
  assert.equal(r.color, "#ff8fb1");
  assert.equal(r.opacity, 1);
});

test("presets are fixed; unknown names fall back", () => {
  assert.deepEqual(cameraPreset("front").position, [0, 0, 14]);
  assert.equal(cameraPreset("nope"), cameraPreset("iso"));
  assert.equal(lightPreset("bright").key, 1.6);
  assert.equal(lightPreset("nope"), lightPreset("soft"));
});

test("orbitPosition keeps the radius and clamps pitch", () => {
  const base = cameraPreset("front").position;
  const p = orbitPosition(base, Math.PI / 2, 0);
  assert.ok(Math.abs(p[0] - 14) < 1e-9 && Math.abs(p[2]) < 1e-9);
  const up = orbitPosition(base, 0, 10);
  assert.ok(Math.abs(Math.hypot(...up) - 14) < 1e-9);
  assert.ok(up[1] < 14 && up[1] > 13);
});

test("parts: labels have no mesh, arrows have two", () => {
  assert.equal(parts("label", 1).length, 0);
  assert.equal(parts("arrow", 2).length, 2);
  assert.equal(parts("sphere", 1)[0]!.args[0], 1);
});

test("budget counts labels and flags more than 60 primitives", () => {
  const mk = (n: number, kind: Primitive["kind"]) => Array.from({ length: n }, (_, i) => ({ ...nuc, id: `p${i}`, kind }));
  const ok = budget({ primitives: [...mk(5, "sphere"), ...mk(2, "label")] } as Pick<Scene3dProps, "primitives">);
  assert.deepEqual(ok, { total: 7, labels: 2, meshes: 5, ok: true });
  assert.equal(budget({ primitives: mk(61, "box") }).ok, false);
});
