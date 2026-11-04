import { blockCount, MAX_PROGRAM_STEPS, type GridCommand, type GridProgram, type GridRun, type GridStep } from "@learnquest/ui-catalog";

export type Mode = "watch" | "solve" | "debug";
/** Everything a button, a key or a tap can ask for. One dispatcher handles them all. */
export type Intent =
  | { type: "add"; cmd: GridCommand }
  | { type: "repeat"; times: number; body: GridCommand[] }
  | { type: "undo" }
  | { type: "clear" }
  | { type: "run" }
  | { type: "step" };
export type Outcome = "play" | "win" | "retry" | "lose";

/** The program editor. A step that would break `max` blocks (a repeat counts 1 plus its body) is refused. */
export function edit(p: GridProgram, a: Intent, max = MAX_PROGRAM_STEPS): GridProgram {
  if (a.type === "undo") return p.slice(0, -1);
  if (a.type === "clear") return [];
  if (a.type !== "add" && a.type !== "repeat") return p;
  if (a.type === "repeat" && !a.body.length) return p;
  const step: GridStep = a.type === "add" ? a.cmd : { repeat: a.times, body: a.body };
  const next = [...p, step];
  return blockCount(next) > max ? p : next;
}

export const controls = (mode: Mode) => ({
  build: mode !== "watch", // solve and debug edit a program
  run: mode !== "watch",
  step: mode === "watch",
  play: mode === "watch",
});

const KEY_CMD: Record<string, GridCommand> = { ArrowUp: "forward", ArrowLeft: "left", ArrowRight: "right", ArrowDown: "pick" };

/** Keyboard to intent. Arrows build the program (only where building exists), Enter runs or steps. */
export function keyIntent(key: string, mode: Mode, palette: readonly GridCommand[]): Intent | null {
  const c = controls(mode);
  if (key === "Enter") return { type: c.run ? "run" : "step" };
  if (!c.build) return null;
  if (key === "Backspace") return { type: "undo" };
  if (key === "Escape") return { type: "clear" };
  const cmd = KEY_CMD[key];
  return cmd && palette.includes(cmd) ? { type: "add", cmd } : null;
}

export const stepText = (s: GridStep) => (typeof s === "string" ? s : `repeat ${s.repeat} times: ${s.body.join(", ")}`);

/** Live-region text for step `i` of a run; bumps and picks already say so in the move text. */
export const announceStep = (run: GridRun, i: number) => `Step ${i + 1} of ${run.trace.length}: ${run.moves[i]}.`;

const bumps = (run: GridRun) => run.moves.filter((m) => m.startsWith("bump")).length;

export function announceRun(run: GridRun, state: Outcome): string {
  const tail = bumps(run) ? ` ${bumps(run)} bump${bumps(run) === 1 ? "" : "s"}.` : "";
  if (state === "win") return `You win! Reached the goal with ${run.gems} gem${run.gems === 1 ? "" : "s"} in ${run.steps} steps.${tail}`;
  const why = `${run.error ?? "The run did not succeed"}.${tail}`;
  return state === "lose" ? `Game over, no lives left. ${why}` : `Not yet: ${why} Change the program and run again.`;
}

/** Win/lose decision. A failed run costs a life when lives are in play; a program that could not start costs nothing. */
export function verdict(run: GridRun, lives?: number): { state: Outcome; lives?: number } {
  if (run.ok) return { state: "win", lives };
  const left = lives === undefined || !run.trace.length ? lives : lives - 1;
  return { state: left !== undefined && left <= 0 ? "lose" : "retry", lives: left };
}
