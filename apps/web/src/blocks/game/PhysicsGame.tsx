import { useMemo, useState } from "react";
import { MAX_ANGLE, MIN_ANGLE, simulateLaunch, type PublicGameProps, type PhysicsProps } from "@learnquest/ui-catalog";
import type { GameApi } from "./api.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import Shell, { btn } from "./Shell.tsx";
import type { Outcome } from "./model.ts";

const W = 400;
const H = 160;

export default function PhysicsGame({ p, kind, api }: { p: PublicGameProps; kind: PhysicsProps; api: GameApi }) {
  const reduced = useReducedMotion();
  const maxLives = p.shell.lives;
  const [angle, setAngle] = useState(45);
  const [speed, setSpeed] = useState(Math.ceil(kind.maxSpeed / 2));
  const [shot, setShot] = useState<ReturnType<typeof simulateLaunch> | null>(null);
  const [lives, setLives] = useState(maxLives);
  const [outcome, setOutcome] = useState<Outcome>("play");
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const over = outcome === "win" || outcome === "lose";
  // Scale so the target and the farthest throw both fit the picture.
  const span = Math.max(kind.target.x + kind.target.width, (kind.maxSpeed * kind.maxSpeed) / 9.8) * 1.1;
  const sx = (x: number) => (x / span) * W;
  const sy = (y: number) => H - 10 - (y / span) * W;
  const preview = useMemo(() => simulateLaunch(kind, angle, speed), [kind, angle, speed]);

  // The picture comes from the shared simulator; whether the throw wins is the server's call.
  const launch = async () => {
    if (over || busy) return;
    setBusy(true);
    try {
      const r = await api.check({ kind: "physics", angle, speed });
      setShot(preview);
      const miss = `${preview.landX < kind.target.x ? "Short" : "Long"}: it landed ${preview.landX.toFixed(1)} metres out, the target is at ${kind.target.x}.`;
      if (r.correct) return (setOutcome("win"), setLive(`You win! It landed ${preview.landX.toFixed(1)} metres out, inside the target.`));
      const left = lives === undefined ? undefined : lives - 1;
      if (left !== undefined) setLives(left);
      if (left !== undefined && left <= 0) return (setOutcome("lose"), setLive(`Game over, no lives left. ${miss}`));
      setLive(`${miss} Change a slider and launch again.`);
    } catch {
      setLive("Couldn't check your throw. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    setShot(null), setOutcome("play"), setLives(maxLives), setLive("Back at the start.");
  };

  const slider = (label: string, value: number, min: number, max: number, set: (n: number) => void, unit: string) => (
    <label className="flex flex-col text-sm font-bold">
      {label}: {value} {unit}
      <input type="range" min={min} max={max} step={1} value={value} disabled={over} onChange={(e) => set(Number(e.target.value))} className="min-h-11" />
    </label>
  );

  // Reduced motion: the finished flight is drawn at once. Otherwise the CSS draw-in animation plays it; it has no timer, so nothing times the learner out.
  const d = shot ? shot.path.map((q, i) => `${i ? "L" : "M"}${sx(q.x).toFixed(1)} ${sy(q.y).toFixed(1)}`).join(" ") : "";
  return (
    <Shell {...p} onHint={api.hint} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry}>
      <div role="group" aria-label="Physics game" className="flex min-w-0 flex-col gap-3">
        <svg role="img" aria-label={`Ground with a target ${kind.target.width} metres wide at ${kind.target.x} metres${shot ? `; last throw landed at ${shot.landX.toFixed(1)} metres` : ""}`} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full rounded-2xl border-2 border-ink bg-paper">
          <line x1={0} x2={W} y1={H - 10} y2={H - 10} stroke="var(--color-ink)" strokeWidth={2} />
          <rect x={sx(kind.target.x - kind.target.width / 2)} y={H - 16} width={Math.max(2, sx(kind.target.width))} height={12} fill="var(--color-green)" stroke="var(--color-ink)" strokeWidth={2} />
          {shot && <path d={d} fill="none" stroke="var(--color-blue)" strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={0} style={reduced ? undefined : { animation: "lq-draw 1s ease-out" }} />}
        </svg>
        {!reduced && <style>{"@keyframes lq-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}"}</style>}
        {slider("Angle", angle, MIN_ANGLE, MAX_ANGLE, setAngle, "degrees")}
        {slider("Speed", speed, 1, kind.maxSpeed, setSpeed, "m/s")}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btn} bg-green`} disabled={over || busy} onClick={launch}>Launch</button>
        </div>
      </div>
    </Shell>
  );
}
