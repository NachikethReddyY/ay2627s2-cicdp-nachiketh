import { z } from "zod";
import type { Issue } from "../../core/parse.ts";
import type { GameKind } from "./shell.ts";

export const GRID_COMMANDS = ["forward", "left", "right", "pick"] as const;
/** Clockwise, so a right turn is +1 and a left turn is +3 (mod 4). */
export const DIRS = ["up", "right", "down", "left"] as const;
export const GRID_MODES = ["watch", "solve", "debug"] as const;
export const MAX_GRID = 10;
export const MAX_WALLS = 60;
export const MAX_GEMS = 10;
/** Most commands a program may run once its repeats are expanded. */
export const MAX_PROGRAM_STEPS = 60;
export const MIN_REPEAT = 2;
export const MAX_REPEAT = 9;
export const MAX_REPEAT_BODY = 6;

export type GridCommand = (typeof GRID_COMMANDS)[number];
export type Dir = (typeof DIRS)[number];
export type Cell = { x: number; y: number };
/** Runs `body` `repeat` times. One level only: a body holds commands, never another repeat. */
export type RepeatStep = { repeat: number; body: GridCommand[] };
export type GridStep = GridCommand | RepeatStep;
export type GridProgram = GridStep[];

/** x runs left to right and y top to bottom, both from 0; "up" is y - 1. */
export type GridProps = {
  kind: "grid";
  size: { w: number; h: number };
  start: Cell & { dir: Dir };
  goal: Cell;
  walls: Cell[];
  gems: Cell[];
  /** The palette: which commands the learner may use. */
  commands: GridCommand[];
  /** Present means repeat blocks are allowed, up to these limits. */
  allowRepeat?: { maxTimes: number; maxBody: number };
  /** Most blocks a program may use; a repeat counts as 1 plus its body. Makes a loop necessary. */
  maxBlocks?: number;
  /** watch plays `solution`; solve has the learner build a program; debug has them fix `starter`. */
  mode: (typeof GRID_MODES)[number];
  maxSteps: number;
  solution?: GridProgram;
  /** debug mode only: a program with a bug, which must not already solve the puzzle. */
  starter?: GridProgram;
};

/** Robot state. `collected` holds indexes into `gems`, in pick order. */
export type GridState = Cell & { dir: Dir; collected: number[] };
/** One simulated step. `at` locates the command in the program: [i], or [i, j] for body command j of repeat i. */
export type GridTraceStep = GridState & { command: GridCommand; at: number[] };
export type GridRun = {
  /** True when the robot reached the goal holding every gem. */
  ok: boolean;
  reachedGoal: boolean;
  /** Gems collected. */
  gems: number;
  steps: number;
  /** The move log: one plain-language line per step, aligned with `trace`. */
  moves: string[];
  trace: GridTraceStep[];
  /** Why the run did not succeed, in words the learner can read. Set whenever ok is false. */
  error?: string;
};

const cellSchema = z.strictObject({ x: z.int().min(0).max(MAX_GRID - 1), y: z.int().min(0).max(MAX_GRID - 1) });
const commandSchema = z.enum(GRID_COMMANDS);
const programSchema = z
  .array(
    z.union([
      commandSchema,
      z.strictObject({ repeat: z.int().min(MIN_REPEAT).max(MAX_REPEAT), body: z.array(commandSchema).min(1).max(MAX_REPEAT_BODY) }),
    ], { error: `a step is a command or {"repeat": ${MIN_REPEAT}-${MAX_REPEAT}, "body": [1 to ${MAX_REPEAT_BODY} commands]}; repeats do not nest` }),
  )
  .min(1)
  .max(MAX_PROGRAM_STEPS);

const gridSchema = z.strictObject({
  kind: z.literal("grid"),
  size: z.strictObject({ w: z.int().min(1).max(MAX_GRID), h: z.int().min(1).max(MAX_GRID) }),
  start: z.strictObject({ x: cellSchema.shape.x, y: cellSchema.shape.y, dir: z.enum(DIRS) }),
  goal: cellSchema,
  walls: z.array(cellSchema).max(MAX_WALLS),
  gems: z.array(cellSchema).max(MAX_GEMS),
  commands: z.array(commandSchema).min(1).max(GRID_COMMANDS.length),
  allowRepeat: z.strictObject({ maxTimes: z.int().min(MIN_REPEAT).max(MAX_REPEAT), maxBody: z.int().min(1).max(MAX_REPEAT_BODY) }).optional(),
  maxBlocks: z.int().min(1).max(MAX_PROGRAM_STEPS).optional(),
  mode: z.enum(GRID_MODES),
  maxSteps: z.int().min(1).max(MAX_PROGRAM_STEPS),
  solution: programSchema.optional(),
  starter: programSchema.optional(),
}) satisfies z.ZodType<GridProps>;

// --- semantics: one transition function, shared by simulate() and solvable() so they cannot disagree ---

const key = (c: Cell) => c.y * MAX_GRID + c.x;
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
type Core = { x: number; y: number; d: number; mask: number };
type Event = "moved" | "edge" | "wall" | "turned" | "picked" | "empty";
type World = { p: GridProps; walls: Set<number>; gemAt: Map<number, number> };

const world = (p: GridProps): World => ({ p, walls: new Set(p.walls.map(key)), gemAt: new Map(p.gems.map((g, i) => [key(g), i])) });

function next(w: World, s: Core, cmd: GridCommand): [Core, Event] {
  if (cmd === "left" || cmd === "right") return [{ ...s, d: (s.d + (cmd === "right" ? 1 : 3)) % 4 }, "turned"];
  if (cmd === "pick") {
    const g = w.gemAt.get(key(s));
    return g === undefined || s.mask & (1 << g) ? [s, "empty"] : [{ ...s, mask: s.mask | (1 << g) }, "picked"];
  }
  const [dx, dy] = DELTA[DIRS[s.d]];
  const to = { x: s.x + dx, y: s.y + dy };
  if (to.x < 0 || to.y < 0 || to.x >= w.p.size.w || to.y >= w.p.size.h) return [s, "edge"];
  if (w.walls.has(key(to))) return [s, "wall"];
  return [{ ...s, ...to }, "moved"];
}

const atGoal = (p: GridProps, s: Cell) => s.x === p.goal.x && s.y === p.goal.y;
const where = (c: Cell) => `column ${c.x + 1}, row ${c.y + 1}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Blocks a program uses: a command is 1, a repeat is 1 plus its body. */
export const blockCount = (program: readonly GridStep[]) =>
  program.reduce((n, s) => n + (typeof s === "string" ? 1 : 1 + s.body.length), 0);

/**
 * Problems that stop a program from running in this puzzle: commands off the palette, repeats that are not
 * allowed or break the limits, nesting, and size. Paths are relative to the program, e.g. "2.body.0".
 * Defensive about shape, so a malformed program gets issues rather than a throw.
 */
export function programIssues(program: unknown, p: GridProps): Issue[] {
  if (!Array.isArray(program)) return [{ path: "", message: "a program is a list of commands" }];
  if (!program.length) return [{ path: "", message: "the program is empty" }];
  const issues: Issue[] = [];
  const allowed = (c: unknown, path: string) => {
    if (typeof c !== "string" || !(GRID_COMMANDS as readonly string[]).includes(c))
      issues.push({ path, message: typeof c === "object" && c !== null ? "a repeat cannot hold another repeat" : "unknown command" });
    else if (!p.commands.includes(c as GridCommand)) issues.push({ path, message: `"${c}" is not one of this puzzle's commands (${p.commands.join(", ")})` });
  };
  let steps = 0;
  program.forEach((s: unknown, i) => {
    if (typeof s === "string") return (steps++, allowed(s, `${i}`));
    const r = s as Partial<RepeatStep> | null;
    if (typeof r !== "object" || r === null || !Array.isArray(r.body)) return issues.push({ path: `${i}`, message: "unknown step" });
    const lim = p.allowRepeat;
    if (!lim) return issues.push({ path: `${i}`, message: "this puzzle does not allow repeat blocks" });
    const n = r.repeat;
    if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_REPEAT || n > lim.maxTimes)
      issues.push({ path: `${i}.repeat`, message: `repeat runs ${MIN_REPEAT} to ${lim.maxTimes} times` });
    if (!r.body.length || r.body.length > lim.maxBody) issues.push({ path: `${i}.body`, message: `a repeat holds 1 to ${lim.maxBody} commands` });
    r.body.forEach((c, j) => allowed(c, `${i}.body.${j}`));
    steps += (typeof n === "number" ? Math.max(0, n) : 0) * r.body.length;
  });
  if (issues.length) return issues;
  if (steps > MAX_PROGRAM_STEPS) issues.push({ path: "", message: `the program runs ${steps} steps; the most is ${MAX_PROGRAM_STEPS}` });
  const blocks = blockCount(program as GridStep[]);
  if (p.maxBlocks !== undefined && blocks > p.maxBlocks) issues.push({ path: "", message: `the program uses ${blocks} blocks; this puzzle allows ${p.maxBlocks}` });
  return issues;
}

/** Runs `program` in the puzzle `p`. Pure and total: a bad program comes back as ok false with `error`, never a throw. */
export function simulate(program: readonly GridStep[], p: GridProps): GridRun {
  const bad = programIssues(program, p)[0];
  if (bad) return { ok: false, reachedGoal: false, gems: 0, steps: 0, moves: [], trace: [], error: bad.message };
  const w = world(p);
  let s: Core = { x: p.start.x, y: p.start.y, d: DIRS.indexOf(p.start.dir), mask: 0 };
  const collected: number[] = [];
  const moves: string[] = [];
  const trace: GridTraceStep[] = [];
  let reachedGoal = false;
  let outOfSteps = false;
  const flat = program.flatMap((st, i) =>
    typeof st === "string" ? [{ cmd: st, at: [i] }] : Array.from({ length: st.repeat }, () => st.body.map((cmd, j) => ({ cmd, at: [i, j] }))).flat(),
  );
  for (const { cmd, at } of flat) {
    if (trace.length >= p.maxSteps) {
      outOfSteps = true;
      break;
    }
    const [n, ev] = next(w, s, cmd);
    if (ev === "picked") collected.push(Math.log2(n.mask ^ s.mask));
    s = n;
    const dir = DIRS[s.d];
    reachedGoal = atGoal(p, s);
    moves.push(
      {
        moved: `forward to ${where(s)}${reachedGoal ? ", the goal" : ""}`,
        edge: `bump: the edge of the grid is ahead, still at ${where(s)}`,
        wall: `bump: a wall is ahead, still at ${where(s)}`,
        turned: `turn ${cmd}, now facing ${dir}`,
        picked: `pick: got the gem at ${where(s)}`,
        empty: `pick: no gem at ${where(s)}`,
      }[ev],
    );
    trace.push({ x: s.x, y: s.y, dir, collected: [...collected], command: cmd, at });
    if (reachedGoal) break;
  }
  const missed = p.gems.length - collected.length;
  const ok = reachedGoal && missed === 0;
  const error = ok
    ? undefined
    : reachedGoal
      ? `reached the goal but missed ${plural(missed, "gem")}`
      : outOfSteps
        ? `stopped after ${plural(p.maxSteps, "step")} without reaching the goal`
        : "the program ended before reaching the goal";
  return { ok, reachedGoal, gems: collected.length, steps: trace.length, moves, trace, ...(error && { error }) };
}

/**
 * True when some program of the allowed commands reaches the goal holding every gem within maxSteps.
 * Breadth-first over (x, y, dir, gems collected): at most 10 x 10 x 4 x 2^10 states. Reaching the goal ends a run.
 */
export function solvable(p: GridProps): boolean {
  const w = world(p);
  const full = (1 << p.gems.length) - 1;
  const id = (s: Core) => ((s.mask * MAX_GRID + s.y) * MAX_GRID + s.x) * 4 + s.d;
  const seen = new Uint8Array(MAX_GRID * MAX_GRID * 4 * (1 << p.gems.length));
  let frontier: Core[] = [{ x: p.start.x, y: p.start.y, d: DIRS.indexOf(p.start.dir), mask: 0 }];
  seen[id(frontier[0])] = 1;
  for (let depth = 0; depth < p.maxSteps && frontier.length; depth++) {
    const after: Core[] = [];
    for (const s of frontier)
      for (const cmd of p.commands) {
        const [n] = next(w, s, cmd);
        if (atGoal(p, n)) {
          if (n.mask === full) return true;
          continue;
        }
        if (!seen[id(n)]) (seen[id(n)] = 1), after.push(n);
      }
    frontier = after;
  }
  return false;
}

const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

export const gridKind: GameKind<GridProps> = {
  schema: gridSchema,
  check: (p) => {
    const issues: Issue[] = [];
    const bad = (path: string, message: string) => issues.push({ path, message });
    const { w, h } = p.size;
    const outside = (c: Cell) => c.x >= w || c.y >= h;
    const grid = `the ${w} by ${h} grid`;
    if (outside(p.start)) bad("start", `start is outside ${grid}`);
    if (outside(p.goal)) bad("goal", `the goal is outside ${grid}`);
    if (same(p.start, p.goal)) bad("goal", "the goal is on the start cell");
    const cells = (list: Cell[], name: string, blocked: [Cell[], string][]) => {
      const seen = new Set<number>();
      list.forEach((c, i) => {
        if (outside(c)) bad(`${name}.${i}`, `this ${name.slice(0, -1)} is outside ${grid}`);
        if (seen.has(key(c))) bad(`${name}.${i}`, `duplicate ${name.slice(0, -1)} at x ${c.x}, y ${c.y}`);
        seen.add(key(c));
        for (const [others, what] of blocked)
          if (others.some((o) => same(o, c))) bad(`${name}.${i}`, `a ${name.slice(0, -1)} is on the ${what}`);
      });
    };
    cells(p.walls, "walls", [[[p.start], "start"], [[p.goal], "goal"]]);
    cells(p.gems, "gems", [[[p.start], "start"], [[p.goal], "goal"], [p.walls, "wall"]]);
    p.commands.forEach((c, i) => p.commands.indexOf(c) !== i && bad(`commands.${i}`, `duplicate command "${c}"`));
    if (issues.length) return issues; // the board must be sound before anything is simulated

    for (const name of ["solution", "starter"] as const)
      if (p[name]) programIssues(p[name], p).forEach((i) => bad(i.path ? `${name}.${i.path}` : name, i.message));
    if (p.mode === "watch" && !p.solution) bad("solution", "watch mode needs a solution to play");
    if (p.maxBlocks !== undefined && !p.solution) bad("solution", "a block limit needs a solution that fits it");
    if (p.mode === "debug" && !p.starter) bad("starter", "debug mode needs a starter program with a bug to fix");
    if (p.mode !== "debug" && p.starter) bad("starter", "only debug mode uses a starter program");
    if (issues.length) return issues;

    if (!solvable(p))
      bad("goal", `the goal cannot be reached${p.gems.length ? " with every gem" : ""} within ${plural(p.maxSteps, "step")} using ${p.commands.join(", ")}`);
    else if (p.solution) {
      const run = simulate(p.solution, p);
      if (!run.ok) bad("solution", `the solution does not solve the puzzle: ${run.error}`);
    }
    if (p.starter && simulate(p.starter, p).ok) bad("starter", "the starter program already solves the puzzle; debug mode needs a bug to fix");
    return issues;
  },
  describe: (p) => {
    const loops = p.allowRepeat ? `, and repeat blocks (up to ${p.allowRepeat.maxTimes} times, ${plural(p.allowRepeat.maxBody, "command")} inside)` : "";
    const mode = { watch: "watch the solution run", solve: "build a program", debug: "fix a program with a bug" }[p.mode];
    return (
      `A ${p.size.w} by ${p.size.h} grid with ${plural(p.walls.length, "wall")} and ${plural(p.gems.length, "gem")}. ` +
      `The robot starts at ${where(p.start)} facing ${p.start.dir}; the goal is at ${where(p.goal)}. ` +
      `Commands: ${p.commands.join(", ")}${loops}. Mode: ${p.mode} (${mode}), up to ${plural(p.maxSteps, "step")}` +
      `${p.maxBlocks !== undefined ? ` and ${plural(p.maxBlocks, "block")}` : ""}.`
    );
  },
};
