import test from "node:test";
import assert from "node:assert/strict";
import { simulate, type GridProps } from "@learnquest/ui-catalog";
import { announceRun, announceStep, controls, edit, keyIntent, verdict } from "./model.ts";

const grid: GridProps = {
  kind: "grid", size: { w: 3, h: 1 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 2, y: 0 }, walls: [], gems: [],
  commands: ["forward", "left", "right", "pick"], mode: "solve", maxSteps: 10,
};

test("editor adds commands and repeats, undoes and clears", () => {
  let p = edit([], { type: "add", cmd: "forward" });
  p = edit(p, { type: "repeat", times: 3, body: ["left", "right"] });
  assert.deepEqual(p, ["forward", { repeat: 3, body: ["left", "right"] }]);
  assert.deepEqual(edit(p, { type: "undo" }), ["forward"]);
  assert.deepEqual(edit(p, { type: "clear" }), []);
  assert.deepEqual(edit([], { type: "undo" }), []);
});

test("editor refuses steps past the block limit and empty repeats", () => {
  assert.deepEqual(edit(["forward"], { type: "add", cmd: "left" }, 1), ["forward"]);
  assert.deepEqual(edit([], { type: "repeat", times: 2, body: ["left", "right"] }, 2), []); // 1 + 2 blocks
  assert.deepEqual(edit([], { type: "repeat", times: 2, body: [] }), []);
});

test("mode maps to controls and keys", () => {
  assert.deepEqual(controls("watch"), { build: false, run: false, step: true, play: true });
  assert.equal(controls("solve").build && controls("debug").run, true);
  assert.deepEqual(keyIntent("ArrowUp", "solve", grid.commands), { type: "add", cmd: "forward" });
  assert.equal(keyIntent("ArrowUp", "watch", grid.commands), null);
  assert.equal(keyIntent("ArrowDown", "solve", ["forward"]), null);
  assert.deepEqual(keyIntent("Enter", "debug", grid.commands), { type: "run" });
  assert.deepEqual(keyIntent("Enter", "watch", grid.commands), { type: "step" });
  assert.deepEqual(keyIntent("Backspace", "solve", grid.commands), { type: "undo" });
  assert.deepEqual(keyIntent("Escape", "solve", grid.commands), { type: "clear" });
});

test("announcements name the step, the bump and the result", () => {
  const run = simulate(["left", "forward", "right", "forward", "forward"], grid); // left turn faces up: bump
  assert.match(announceStep(run, 1), /^Step 2 of 5: bump: the edge/);
  assert.match(announceRun(run, "win"), /1 bump\./);
  const win = simulate(["forward", "forward"], grid);
  assert.equal(announceRun(win, "win"), "You win! Reached the goal with 0 gems in 2 steps.");
});

test("verdict: win, retry, lose, and no life lost when nothing ran", () => {
  const win = simulate(["forward", "forward"], grid);
  const miss = simulate(["forward"], grid);
  assert.deepEqual(verdict(win, 2), { state: "win", lives: 2 });
  assert.deepEqual(verdict(miss, 2), { state: "retry", lives: 1 });
  assert.deepEqual(verdict(miss, 1), { state: "lose", lives: 0 });
  assert.deepEqual(verdict(miss), { state: "retry", lives: undefined });
  assert.deepEqual(verdict(simulate([], grid), 1), { state: "retry", lives: 1 });
});
