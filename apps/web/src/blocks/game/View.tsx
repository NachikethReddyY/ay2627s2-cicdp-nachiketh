import { useMemo, useState, type ReactElement } from "react";
import { DIRS, MAX_PROGRAM_STEPS, simulate, type Cell, type PublicGameProps, type GridCommand, type GridProgram, type GridProps, type GridRun } from "@learnquest/ui-catalog";
import type { BlockViewProps } from "../registry.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import { gameApi, type GameApi } from "./api.ts";
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

function GridGame({ p, g, api }: { p: PublicGameProps; g: GridProps; api: GameApi }) {
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
  const [busy, setBusy] = useState(false);
  const run = watch ?? ran;
  const at: At = idx > 0 && run ? run.trace[idx - 1]! : start;
  const max = g.maxBlocks ?? MAX_PROGRAM_STEPS;

  // One place for buttons, keys and taps.
  const dispatch = (i: Intent) => {
    if (outcome === "win" || outcome === "lose") return;
    if (busy) return;
    if (i.type === "step") {
      if (!watch || !g.solution || idx >= watch.trace.length) return setLive(watch ? "End of the solution." : "");
      setIdx(idx + 1);
      const text = announceStep(watch, idx);
      if (idx + 1 < watch.trace.length) return setLive(text);
      // Reaching the end of a watched solution is the win, but the server decides: it replays the program and records it.
      setBusy(true);
      api.check({ kind: "grid", program: g.solution })
        .then((r) => (r.complete ? (setOutcome("win"), setLive(`${text} End of the solution.`)) : setLive(text)))
        .catch(() => setLive(`${text} Couldn't check the run. Step again to retry.`))
        .finally(() => setBusy(false));
      return;
    }
    if (!c.build) return;
    if (i.type === "run") {
      if (!program.length) return setLive("Add a command first.");
      // The trace and move log come from the shared simulator; whether the run wins is the server's call.
      const r = simulate(program, g);
      setBusy(true);
      api.check({ kind: "grid", program })
        .then((res) => {
          const shown = { ...r, ok: res.correct };
          const v = verdict(shown, lives);
          setRan(shown), setIdx(shown.trace.length), setLives(v.lives), setOutcome(v.state), setLive(announceRun(shown, v.state));
        })
        .catch(() => setLive("Couldn't check the run. Try again."))
        .finally(() => setBusy(false));
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
    <Shell {...p} onHint={api.hint} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry}>
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

export default function GameView({ block, gameCompletion }: BlockViewProps<PublicGameProps>) {
  const p = block.props;
  const api = useMemo(() => gameApi(gameCompletion, p.gameIndex), [gameCompletion, p.gameIndex]);
  if (p.kind.kind === "grid") return <GridGame p={p} g={p.kind} api={api} />;
  if (p.kind.kind === "order" || p.kind.kind === "match" || p.kind.kind === "sort") return <DragGame p={p} kind={p.kind} api={api} />;
  if (p.kind.kind === "physics") return <PhysicsGame p={p} kind={p.kind} api={api} />;
  if (p.kind.kind === "quiz") return <QuizGame p={p} kind={p.kind} api={api} />;
  return <p className="break-words rounded-2xl border-2 border-ink bg-white p-3 text-sm">{p.alt}</p>;
}
