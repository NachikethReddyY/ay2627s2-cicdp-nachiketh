import { useMemo, useState, type ReactElement } from "react";
import { BLOCKS, DIRS, MAX_PROGRAM_STEPS, simulate, type Cell, type GameProps, type GridCommand, type GridProgram, type GridProps, type GridRun } from "@learnquest/ui-catalog";
import type { BlockViewProps } from "../registry.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { trpc } from "../../lib/trpc.ts";
import Shell, { btn } from "./Shell.tsx";
import DragGame from "./DragGame.tsx";
import PhysicsGame from "./PhysicsGame.tsx";
import QuizGame from "./QuizGame.tsx";
import { announceRun, announceStep, controls, edit, keyIntent, stepText, verdict, type Intent, type Outcome } from "./model.ts";

const C = 40;
const LABEL: Record<GridCommand, string> = { forward: "Forward", left: "Turn left", right: "Turn right", pick: "Pick" };
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

type At = Cell & { dir: (typeof DIRS)[number]; collected: number[] };

function Robot({ dir, stroke }: { dir: At["dir"]; stroke?: boolean }) {
  return (
    <g transform={`rotate(${DIRS.indexOf(dir) * 90} ${C / 2} ${C / 2})`}>
      <polygon points="20,7 32,32 8,32" fill={stroke ? "none" : "var(--color-blue)"} stroke="var(--color-ink)" strokeWidth={2} strokeDasharray={stroke ? "3 3" : undefined} />
    </g>
  );
}

function Board({ g, at, reduced }: { g: GridProps; at: At; reduced: boolean }) {
  const cells: ReactElement[] = [];
  for (let y = 0; y < g.size.h; y++)
    for (let x = 0; x < g.size.w; x++) {
      const c = { x, y };
      const wall = g.walls.some((w) => same(w, c));
      const gem = g.gems.findIndex((m) => same(m, c));
      const gemOn = gem >= 0 && !at.collected.includes(gem);
      const parts = [`Column ${x + 1}, row ${y + 1}`, wall && "wall", same(g.start, c) && `start, facing ${g.start.dir}`, same(g.goal, c) && "goal", gemOn && "gem", same(at, c) && `robot, facing ${at.dir}`].filter(Boolean);
      cells.push(
        <g key={`${x},${y}`} role="img" aria-label={parts.join(", ")} transform={`translate(${x * C} ${y * C})`}>
          <rect width={C} height={C} fill={wall ? "var(--color-ink)" : "var(--color-paper)"} stroke="var(--color-ink)" strokeWidth={1} />
          {same(g.start, c) && <Robot dir={g.start.dir} stroke />}
          {same(g.goal, c) && <path d="M13 33V8l15 6-15 6" fill="var(--color-green)" stroke="var(--color-ink)" strokeWidth={2} />}
          {gemOn && <polygon points="20,10 29,20 20,30 11,20" fill="var(--color-sun)" stroke="var(--color-ink)" strokeWidth={2} />}
        </g>,
      );
    }
  return (
    <svg role="group" aria-label="Grid" viewBox={`0 0 ${g.size.w * C} ${g.size.h * C}`} style={{ width: "100%", maxWidth: g.size.w * 64, height: "auto" }} className="block">
      {cells}
      {/* aria-hidden: the robot is already in its cell's label. The slide is decorative, so reduced motion drops it. */}
      <g aria-hidden="true" style={{ transform: `translate(${at.x * C}px, ${at.y * C}px)`, transition: reduced ? undefined : "transform 150ms ease-out" }}>
        <Robot dir={at.dir} />
      </g>
    </svg>
  );
}

function GridGame({ p, g, onComplete }: { p: GameProps; g: GridProps; onComplete?: () => void | Promise<unknown> }) {
  const reduced = useReducedMotion();
  const c = controls(g.mode);
  const start: At = { x: g.start.x, y: g.start.y, dir: g.start.dir, collected: [] };
  const init = useMemo<GridProgram>(() => (g.mode === "debug" ? g.starter ?? [] : []), [g]);
  const watch = useMemo(() => (g.mode === "watch" && g.solution ? simulate(g.solution, g) : null), [g]);
  const maxLives = p.shell.lives;
  const [program, setProgram] = useState(init);
  const [draft, setDraft] = useState<{ times: number; body: GridCommand[] }>({ times: 2, body: [] });
  const [ran, setRan] = useState<GridRun | null>(null);
  const [idx, setIdx] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>("play");
  const [lives, setLives] = useState(maxLives);
  const [live, setLive] = useState("");
  const run = watch ?? ran;
  const at: At = idx > 0 && run ? run.trace[idx - 1]! : start;
  const max = g.maxBlocks ?? MAX_PROGRAM_STEPS;

  // One place for buttons, keys and taps.
  const dispatch = (i: Intent) => {
    if (outcome === "win" || outcome === "lose") return;
    if (i.type === "step") {
      if (!watch || idx >= watch.trace.length) return setLive(watch ? "End of the solution." : "");
      setIdx(idx + 1);
      // Reaching the end of a watched solution is the win, so the Shell reports completion like any other win.
      if (idx + 1 === watch.trace.length) setOutcome("win");
      return setLive(announceStep(watch, idx) + (idx + 1 === watch.trace.length ? " End of the solution." : ""));
    }
    if (!c.build) return;
    if (i.type === "run") {
      if (!program.length) return setLive("Add a command first.");
      const r = simulate(program, g);
      const v = verdict(r, lives);
      setRan(r), setIdx(r.trace.length), setLives(v.lives), setOutcome(v.state), setLive(announceRun(r, v.state));
      return;
    }
    const next = edit(program, i, max);
    setProgram(next), setRan(null), setIdx(0), setOutcome("play");
    setLive(next === program && i.type !== "clear" && i.type !== "undo" ? "No room for that step." : i.type === "add" ? `Added ${i.cmd}.` : i.type === "undo" ? "Removed the last step." : i.type === "clear" ? "Cleared the program." : "Added a repeat.");
  };

  const retry = () => {
    setProgram(init), setRan(null), setIdx(0), setDraft({ times: 2, body: [] });
    if (outcome === "win" || outcome === "lose") setLives(maxLives);
    setOutcome("play"), setLive("Back at the start.");
  };

  return (
    <Shell {...p} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry} onComplete={onComplete}>
      <div
        role="group" aria-label="Game controls" tabIndex={0} className="flex min-w-0 flex-col gap-3"
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          if (e.altKey || e.ctrlKey || e.metaKey || t.tagName === "SELECT" || (e.key === "Enter" && t.tagName === "BUTTON")) return;
          const i = keyIntent(e.key, g.mode, g.commands);
          if (i) (e.preventDefault(), dispatch(i));
        }}
      >
        <Board g={g} at={at} reduced={reduced} />
        {c.step && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => dispatch({ type: "step" })}>Step</button>
            {/* shortcut: Play is one step per press (no timer, WCAG 2.2.1), so it matches Step; it is off under reduced motion */}
            <button type="button" className={btn} disabled={reduced} onClick={() => dispatch({ type: "step" })}>Play</button>
          </div>
        )}
        {c.build && (
          <>
            <ol aria-label="Your program" className="list-decimal pl-5 text-sm">
              {program.length ? program.map((s, i) => <li key={i}>{stepText(s)}</li>) : <li className="list-none">No steps yet.</li>}
            </ol>
            <div className="flex flex-wrap gap-2">
              {g.commands.map((cmd) => <button key={cmd} type="button" className={btn} onClick={() => dispatch({ type: "add", cmd })}>{LABEL[cmd]}</button>)}
            </div>
            {g.allowRepeat && (
              <fieldset className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-ink p-2">
                <legend className="px-1 text-sm font-extrabold">Repeat block</legend>
                <label className="text-sm font-bold">Times{" "}
                  <select className="min-h-11 rounded-full border-2 border-ink bg-white px-2" value={draft.times} onChange={(e) => setDraft({ ...draft, times: Number(e.target.value) })}>
                    {Array.from({ length: g.allowRepeat.maxTimes - 1 }, (_, k) => k + 2).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                {g.commands.map((cmd) => (
                  <button key={cmd} type="button" className={btn} aria-label={`Put ${LABEL[cmd]} in the repeat`}
                    onClick={() => draft.body.length < g.allowRepeat!.maxBody && setDraft({ ...draft, body: [...draft.body, cmd] })}>+ {LABEL[cmd]}</button>
                ))}
                <p className="w-full break-words text-sm">Inside: {draft.body.join(", ") || "nothing yet"}</p>
                <button type="button" className={btn} onClick={() => setDraft({ ...draft, body: draft.body.slice(0, -1) })}>Undo inside</button>
                <button type="button" className={btn} disabled={!draft.body.length} onClick={() => (dispatch({ type: "repeat", ...draft }), setDraft({ ...draft, body: [] }))}>Add repeat</button>
              </fieldset>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${btn} bg-green`} onClick={() => dispatch({ type: "run" })}>Run</button>
              <button type="button" className={btn} onClick={() => dispatch({ type: "undo" })}>Undo</button>
              <button type="button" className={btn} onClick={() => dispatch({ type: "clear" })}>Clear</button>
            </div>
            <p className="text-xs">Keys: arrows add steps (up forward, down pick), Enter runs, Backspace removes the last step, Escape clears.</p>
          </>
        )}
        {run && idx > 0 && (
          <ol aria-label="Move log" className="list-decimal break-words pl-5 text-sm">
            {run.moves.slice(0, idx).map((m, i) => <li key={i}>{m}</li>)}
          </ol>
        )}
      </div>
    </Shell>
  );
}

export default function GameView({ block, gameCompletion }: BlockViewProps<GameProps>) {
  const p = block.props;
  const onComplete = useMemo(
    () => (gameCompletion ? () => trpc.games.complete.mutate({ ...gameCompletion, blockId: block.id }) : undefined),
    [gameCompletion, block.id],
  );
  if (p.kind.kind === "grid") return <GridGame p={p} g={p.kind} onComplete={onComplete} />;
  if (p.kind.kind === "order" || p.kind.kind === "match" || p.kind.kind === "sort") return <DragGame p={p} kind={p.kind} onComplete={onComplete} />;
  if (p.kind.kind === "physics") return <PhysicsGame p={p} kind={p.kind} onComplete={onComplete} />;
  if (p.kind.kind === "quiz") return <QuizGame p={p} kind={p.kind} onComplete={onComplete} />;
  return <p className="break-words rounded-2xl border-2 border-ink bg-white p-3 text-sm">{BLOCKS.find((m) => m.type === "game")!.describe(block)}</p>;
}
