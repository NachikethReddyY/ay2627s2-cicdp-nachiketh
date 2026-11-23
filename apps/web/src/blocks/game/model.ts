import { blockCount, MAX_PROGRAM_STEPS, type GridCommand, type GridProgram, type GridRun, type GridStep } from "@learnquest/ui-catalog";

export type Mode = "watch" | "solve" | "debug";
export type Intent =
  | { type: "add"; cmd: GridCommand }
  | { type: "repeat"; times: number; body: GridCommand[] }
  | { type: "undo" }
  | { type: "clear" }
  | { type: "run" }
  | { type: "step" };
export type Outcome = "play" | "win" | "retry" | "lose";

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
  build: mode !== "watch",
  run: mode !== "watch",
  step: mode === "watch",
  play: mode === "watch",
});

const KEY_CMD: Record<string, GridCommand> = { ArrowUp: "forward", ArrowLeft: "left", ArrowRight: "right", ArrowDown: "pick" };

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

export const announceStep = (run: GridRun, i: number) => `Step ${i + 1} of ${run.trace.length}: ${run.moves[i]}.`;

export const announceFrame = (frames: readonly { x: number; y: number; dir: string; collected: number[] }[], i: number) => {
  const f = frames[i];
  const gems = f.collected.length;
  return `Step ${i + 1} of ${frames.length}: column ${f.x + 1}, row ${f.y + 1}, facing ${f.dir}, ${gems} gem${gems === 1 ? "" : "s"} picked.`;
};

const bumps = (run: GridRun) => run.moves.filter((m) => m.startsWith("bump")).length;

export function announceRun(run: GridRun, state: Outcome): string {
  const tail = bumps(run) ? ` ${bumps(run)} bump${bumps(run) === 1 ? "" : "s"}.` : "";
  if (state === "win") return `You win! Reached the goal with ${run.gems} gem${run.gems === 1 ? "" : "s"} in ${run.steps} steps.${tail}`;
  const why = `${run.error ?? "The run did not succeed"}.${tail}`;
  return state === "lose" ? why : `Not yet: ${why} Change the program and run again.`;
}
