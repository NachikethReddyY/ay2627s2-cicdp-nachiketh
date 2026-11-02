import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { BLOCKS, GRID_COMMANDS, parseSpec, simulate, solvable, type GameProps, type GridProps, type GridStep } from "../src/index.ts";

const load = (n: string) => readFileSync(new URL(`../fixtures/game/${n}.json`, import.meta.url), "utf8");
const mod = BLOCKS.find((m) => m.type === "game")!;
const fixture = (n: string) => (JSON.parse(load(n)).blocks[0].props as GameProps).kind as GridProps;
const SOLVE = fixture("valid-grid-solve");
const LOOP = fixture("valid-grid-loop");
// An open 3 by 3 board, robot at the centre facing up, goal top-left, one gem at the centre-left.
const open = (o: Partial<GridProps> = {}): GridProps => ({
  kind: "grid",
  size: { w: 3, h: 3 },
  start: { x: 1, y: 1, dir: "up" },
  goal: { x: 0, y: 0 },
  walls: [],
  gems: [],
  commands: ["forward", "left", "right", "pick"],
  mode: "solve",
  maxSteps: 20,
  ...o,
});
const game = (kind: unknown, extra: object = {}) => ({
  v: 1,
  blocks: [{ type: "game", id: "g", props: { title: "T", goalText: "G", alt: "A", hints: [], shell: {}, kind, ...extra } }],
});
const issues = (kind: unknown, extra?: object) => parseSpec(game(kind, extra)).issues;

test("valid game fixtures parse cleanly", () => {
  for (const n of ["valid-grid-solve", "valid-grid-loop"]) {
    const r = parseSpec(load(n));
    assert.ok(r.ok, n);
    assert.deepEqual(r.issues, []);
  }
});

// Each negative fixture is [text block, bad game]; the game is dropped and the text kept.
for (const [name, path, msg] of [
  ["unsolvable", "blocks.1.props.kind.goal", /cannot be reached/],
  ["goal-in-wall", "blocks.1.props.kind.walls.0", /wall is on the goal/],
  ["repeat-in-repeat", "blocks.1.props.kind.solution.0", /do not nest/],
  ["repeat-too-long", "blocks.1.props.kind.solution.0", /1 to 6 commands/],
  ["command-not-allowed", "blocks.1.props.kind.solution.1", /"left" is not one of this puzzle's commands/],
  ["solution-fails", "blocks.1.props.kind.solution", /does not solve.*missed 1 gem/],
  ["gem-on-wall", "blocks.1.props.kind.gems.0", /gem is on the wall/],
  ["too-many-hints", "blocks.1.props.hints", /3/],
] as const) {
  test(`game/${name} drops the bad block`, () => {
    const r = parseSpec(load(name));
    assert.ok(r.ok);
    assert.equal(r.spec.blocks.length, 1);
    assert.equal(r.issues[0].path, path);
    assert.match(r.issues[0].message, msg);
  });
}

test("forward moves one cell in the facing direction; left and right turn", () => {
  const r = simulate(["forward", "left", "forward"], open({ goal: { x: 2, y: 2 } }));
  assert.deepEqual(r.trace.map(({ x, y, dir }) => [x, y, dir]), [[1, 0, "up"], [1, 0, "left"], [0, 0, "left"]]);
  assert.equal(simulate(["right", "right", "right", "right"], open()).trace.at(-1)!.dir, "up");
  assert.deepEqual(r.trace.map((t) => t.command), ["forward", "left", "forward"]);
});

test("a bump into a wall or the edge leaves the robot in place and says so", () => {
  const r = simulate(["forward", "forward"], open({ walls: [{ x: 1, y: 0 }], goal: { x: 2, y: 2 } }));
  assert.deepEqual([r.trace[0].x, r.trace[0].y], [1, 1]);
  assert.match(r.moves[0], /bump: a wall is ahead/);
  const e = simulate(["forward", "forward"], open({ goal: { x: 2, y: 2 } }));
  assert.match(e.moves[1], /bump: the edge of the grid/);
  assert.equal(e.trace[1].y, 0);
});

test("pick collects a gem once; picking an empty cell is logged", () => {
  const p = open({ gems: [{ x: 1, y: 0 }] });
  const r = simulate(["forward", "pick", "pick", "left", "forward"], p);
  assert.deepEqual(r.moves.slice(1, 3), ["pick: got the gem at column 2, row 1", "pick: no gem at column 2, row 1"]);
  assert.deepEqual(r.trace[1].collected, [0]);
  assert.equal(r.gems, 1);
  assert.ok(r.ok);
  assert.deepEqual(simulate(["pick", "forward", "left", "forward"], p).error, "reached the goal but missed 1 gem");
});

test("the move log has one line per step and ends at the goal", () => {
  const r = simulate(SOLVE.solution!, SOLVE);
  assert.ok(r.ok);
  assert.equal(r.error, undefined);
  assert.equal(r.steps, 7);
  assert.equal(r.moves.length, r.trace.length);
  assert.deepEqual(r.moves, [
    "forward to column 2, row 1",
    "forward to column 3, row 1",
    "forward to column 4, row 1",
    "pick: got the gem at column 4, row 1",
    "turn right, now facing down",
    "forward to column 4, row 2",
    "forward to column 4, row 3, the goal",
  ]);
  // Reaching the goal ends the run; later commands are not run.
  assert.equal(simulate([...SOLVE.solution!, "forward"], SOLVE).steps, 7);
});

test("a repeat expands in order and the trace points back at it", () => {
  const r = simulate(LOOP.solution!, LOOP);
  assert.ok(r.ok);
  assert.equal(r.steps, 19, "the last turn right never runs: the 19th step lands on the goal");
  assert.deepEqual(r.trace.slice(0, 5).map((t) => t.command), ["forward", "left", "forward", "right", "forward"]);
  assert.deepEqual(r.trace.slice(3, 5).map((t) => t.at), [[0, 3], [0, 0]]);
  // The flat program does the same moves but breaks the 5-block limit: the loop is needed.
  const flat: GridStep[] = Array.from({ length: 5 }, () => ["forward", "left", "forward", "right"] as const).flat();
  assert.match(simulate(flat, LOOP).error!, /20 blocks; this puzzle allows 5/);
  assert.ok(simulate(flat, { ...LOOP, maxBlocks: undefined }).ok);
});

test("maxSteps stops the run", () => {
  const r = simulate([{ repeat: 9, body: ["left"] }], open({ maxSteps: 4, allowRepeat: { maxTimes: 9, maxBody: 6 } }));
  assert.equal(r.steps, 4);
  assert.equal(r.ok, false);
  assert.equal(r.error, "stopped after 4 steps without reaching the goal");
  assert.equal(simulate(["left"], open()).error, "the program ended before reaching the goal");
});

test("simulate refuses programs that break the puzzle's rules instead of throwing", () => {
  const p = open({ commands: ["forward", "left"] });
  assert.match(simulate(["right"], p).error!, /not one of this puzzle's commands/);
  assert.match(simulate([{ repeat: 2, body: ["left"] }], p).error!, /does not allow repeat/);
  const r = open({ allowRepeat: { maxTimes: 3, maxBody: 2 } });
  assert.match(simulate([{ repeat: 4, body: ["left"] }], r).error!, /2 to 3 times/);
  assert.match(simulate([{ repeat: 2, body: ["left", "left", "left"] }], r).error!, /1 to 2 commands/);
  assert.match(simulate([{ repeat: 2, body: [{ repeat: 2, body: ["left"] }] as never }], r).error!, /cannot hold another repeat/);
  assert.match(simulate([], p).error!, /empty/);
  const big = open({ allowRepeat: { maxTimes: 9, maxBody: 6 } });
  assert.match(simulate(Array(2).fill({ repeat: 9, body: ["left", "left", "left", "left"] }), big).error!, /72 steps; the most is 60/);
});

test("solvable: BFS over position, direction and gems", () => {
  assert.ok(solvable(SOLVE));
  assert.ok(solvable(LOOP));
  assert.ok(solvable(open()));
  assert.equal(solvable(open({ walls: [{ x: 0, y: 1 }, { x: 1, y: 0 }] })), false, "goal walled in");
  assert.equal(solvable(open({ maxSteps: 2 })), false, "needs 3 steps");
  assert.ok(solvable(open({ maxSteps: 3 })));
  assert.equal(solvable(open({ commands: ["forward", "right"], start: { x: 1, y: 1, dir: "down" }, maxSteps: 3 })), false);
  assert.equal(solvable(open({ gems: [{ x: 2, y: 2 }], commands: ["forward", "left", "right"] })), false, "no pick");
  // The goal ends the run, so a gem behind the goal on a one-row board is out of reach.
  assert.equal(solvable(open({ size: { w: 3, h: 1 }, start: { x: 0, y: 0, dir: "right" }, goal: { x: 1, y: 0 }, gems: [{ x: 2, y: 0 }] })), false);
});

test("check rejects a bad board, each with a path", () => {
  const at = (kind: unknown, extra?: object) => issues(kind, extra).map((i) => i.path);
  assert.deepEqual(at(open({ start: { x: 3, y: 0, dir: "up" } })), ["blocks.0.props.kind.start"]);
  assert.deepEqual(at(open({ goal: { x: 0, y: 5 } })), ["blocks.0.props.kind.goal"]);
  assert.deepEqual(at(open({ goal: { x: 1, y: 1 } })), ["blocks.0.props.kind.goal"]);
  assert.deepEqual(at(open({ walls: [{ x: 2, y: 2 }, { x: 2, y: 2 }] })), ["blocks.0.props.kind.walls.1"]);
  assert.deepEqual(at(open({ walls: [{ x: 1, y: 1 }] })), ["blocks.0.props.kind.walls.0"]);
  assert.deepEqual(at(open({ gems: [{ x: 0, y: 0 }] })), ["blocks.0.props.kind.gems.0"]);
  assert.deepEqual(at(open({ gems: [{ x: 2, y: 2 }, { x: 2, y: 2 }] })), ["blocks.0.props.kind.gems.1"]);
  assert.deepEqual(at(open({ commands: ["left", "left"] })), ["blocks.0.props.kind.commands.1"]);
  assert.deepEqual(at(open({ size: { w: 11, h: 3 } })), ["blocks.0.props.kind.size.w"]);
  assert.deepEqual(at(open({ walls: Array(61).fill({ x: 2, y: 2 }) })), ["blocks.0.props.kind.walls"]);
  assert.deepEqual(at(open(), { alt: "x".repeat(401) }), ["blocks.0.props.alt"]);
  assert.deepEqual(at(open(), { shell: { lives: 6 } }), ["blocks.0.props.shell.lives"]);
  assert.deepEqual(at({ ...open(), kind: "maze" }), ["blocks.0.props.kind.kind"]);
});

test("check enforces the modes, solution and starter", () => {
  const msg = (kind: unknown) => issues(kind).map((i) => `${i.path}: ${i.message}`);
  assert.deepEqual(msg(open({ mode: "watch" })), ["blocks.0.props.kind.solution: watch mode needs a solution to play"]);
  assert.deepEqual(msg(open({ mode: "debug" })), ["blocks.0.props.kind.starter: debug mode needs a starter program with a bug to fix"]);
  assert.match(msg(open({ starter: ["forward"] }))[0], /^blocks\.0\.props\.kind\.starter: only debug mode/);
  assert.match(msg(open({ maxBlocks: 3 }))[0], /^blocks\.0\.props\.kind\.solution: a block limit needs a solution/);
  const fixed = ["forward", "left", "forward"] as GridStep[];
  assert.deepEqual(msg(open({ mode: "debug", solution: fixed, starter: fixed })), [
    "blocks.0.props.kind.starter: the starter program already solves the puzzle; debug mode needs a bug to fix",
  ]);
  assert.deepEqual(msg(open({ mode: "debug", solution: fixed, starter: ["forward", "right", "forward"] })), []);
  assert.deepEqual(msg(open({ mode: "watch", solution: fixed })), []);
});

test("describe gives the title, goal, board, commands and mode", () => {
  const r = parseSpec(load("valid-grid-solve"));
  assert.ok(r.ok);
  const d = mod.describe(r.spec.blocks[0]);
  for (const part of [/^Game: Get the gem\./, /Goal: Pick up the gem/, /4 by 3 grid with 2 walls and 1 gem\./, /Commands: forward, left, right, pick\./, /Mode: solve/, /3 lives, 2 hints\./])
    assert.match(d, part);
});

test("prompt example is itself a valid block", () => {
  const ex = mod.prompt.match(/Example: (\{.*\})/)![1];
  const r = parseSpec({ v: 1, blocks: [JSON.parse(ex)] });
  assert.ok(r.ok, JSON.stringify(r.issues));
  assert.deepEqual(r.issues, []);
});

test("budget is 2 game blocks per spec", () => {
  const b = JSON.parse(load("valid-grid-solve")).blocks[0];
  const r = parseSpec({ v: 1, blocks: [1, 2, 3].map((i) => ({ ...b, id: `g${i}` })) });
  assert.ok(r.ok);
  assert.equal(r.spec.blocks.length, 2);
  assert.match(r.issues[0].message, /too many "game" blocks \(max 2\)/);
});

// Any program from the grammar, including repeats that break the puzzle's limits.
const command = fc.constantFrom(...GRID_COMMANDS);
const step: fc.Arbitrary<GridStep> = fc.oneof(command, fc.record({ repeat: fc.integer({ min: -1, max: 12 }), body: fc.array(command, { maxLength: 8 }) }));
const board = fc.constantFrom(SOLVE, LOOP, open({ gems: [{ x: 2, y: 0 }], allowRepeat: { maxTimes: 9, maxBody: 6 } }), open({ commands: ["forward"] }));

test("simulate never throws on any program built from the grammar", () => {
  fc.assert(
    fc.property(fc.array(step, { maxLength: 70 }), board, (program, p) => {
      const r = simulate(program, p);
      assert.ok(r.steps <= p.maxSteps);
      assert.equal(r.moves.length, r.steps);
      assert.equal(r.trace.length, r.steps);
      assert.equal(r.ok, r.error === undefined);
      if (r.ok) assert.ok(r.reachedGoal && r.gems === p.gems.length);
    }),
    { numRuns: 2000 },
  );
});

test("a winning run means the board is solvable", () => {
  fc.assert(
    fc.property(fc.array(command, { minLength: 1, maxLength: 12 }), (program) => {
      const p = open({ gems: [{ x: 2, y: 0 }], maxSteps: 12 });
      if (simulate(program, p).ok) assert.ok(solvable(p));
    }),
  );
});
