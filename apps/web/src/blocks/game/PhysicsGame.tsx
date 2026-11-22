import { useMemo, useRef, useState } from "react";
import { MAX_ANGLE, MIN_ANGLE, simulateLaunch, type PublicGameProps, type PhysicsProps } from "@learnquest/ui-catalog";
import type { ActiveGameApi } from "./api.ts";
import { useReducedMotion } from "../hooks/useReducedMotion.ts";
import Shell, { btnPrimary } from "./Shell.tsx";
import type { Outcome } from "./model.ts";

const W = 400;
const H = 160;

export default function PhysicsGame({ p, kind, api }: { p: PublicGameProps; kind: PhysicsProps; api: ActiveGameApi }) {
  const reduced = useReducedMotion();
  const maxLives = api.maxAttempts;
  const [angle, setAngle] = useState(45);
  const [speed, setSpeed] = useState(Math.ceil(kind.maxSpeed / 2));
  const [shot, setShot] = useState<ReturnType<typeof simulateLaunch> | null>(null);
  const [lives, setLives] = useState(api.remainingAttempts);
  const [outcome, setOutcome] = useState<Outcome>(api.remainingAttempts > 0 ? "play" : "lose");
  const [live, setLive] = useState("");
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  const over = outcome === "win" || outcome === "lose";
  const span = Math.max(kind.target.x + kind.target.width, (kind.maxSpeed * kind.maxSpeed) / 9.8) * 1.1;
  const sx = (x: number) => (x / span) * W;
  const sy = (y: number) => H - 10 - (y / span) * W;
  const preview = useMemo(() => simulateLaunch(kind, angle, speed), [kind, angle, speed]);

  const launch = async () => {
    if (over || busy) return;
    setBusy(true);
    const mine = gen.current;
    try {
      const r = await api.check({ kind: "physics", angle, speed });
      if (mine !== gen.current) return;
      setLives(r.remainingAttempts);
      setShot(preview);
      const miss = `${preview.landX < kind.target.x ? "Short" : "Long"}: it landed ${preview.landX.toFixed(1)} metres out, the target is at ${kind.target.x}.`;
      if (r.correct) return (setOutcome("win"), setLive(`You win! It landed ${preview.landX.toFixed(1)} metres out, inside the target.`));
      if (r.remainingAttempts === 0) return (setOutcome("lose"), setLive(miss));
      setLive(`${miss} Change a slider and launch again.`);
    } catch {
      if (mine === gen.current) setLive("Couldn't check your throw. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    gen.current++;
    setShot(null), setOutcome("play"), setLive("Back at the start.");
  };

  const slider = (label: string, value: number, min: number, max: number, set: (n: number) => void, unit: string) => (
    <label className="flex flex-col text-sm font-medium">
      {label}: {value} {unit}
      <input type="range" min={min} max={max} step={1} value={value} disabled={over} onChange={(e) => set(Number(e.target.value))} className="min-h-11 accent-[var(--ac)]" />
    </label>
  );

  const d = shot ? shot.path.map((q, i) => `${i ? "L" : "M"}${sx(q.x).toFixed(1)} ${sy(q.y).toFixed(1)}`).join(" ") : "";
  return (
    <Shell {...p} onHint={api.hint} lives={lives} maxLives={maxLives} outcome={outcome} live={live} onRetry={retry} busy={busy}>
      <div role="group" aria-label="Physics game" className="flex min-w-0 flex-col gap-3">
        <svg role="img" aria-label={`Ground with a target ${kind.target.width} metres wide at ${kind.target.x} metres${shot ? `; last throw landed at ${shot.landX.toFixed(1)} metres` : ""}`} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full rounded-xl border border-[var(--line)] bg-[var(--code)]">
          <line x1={0} x2={W} y1={H - 10} y2={H - 10} stroke="var(--mu)" strokeWidth={2} />
          <rect x={sx(kind.target.x - kind.target.width / 2)} y={H - 16} width={Math.max(2, sx(kind.target.width))} height={12} fill="var(--ok)" stroke="var(--okT)" strokeWidth={1.5} rx={2} />
          {shot && <path d={d} fill="none" stroke="var(--ac)" strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={0} style={reduced ? undefined : { animation: "lq-draw 1s ease-out" }} />}
        </svg>
        {!reduced && <style>{"@keyframes lq-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}"}</style>}
        {slider("Angle", angle, MIN_ANGLE, MAX_ANGLE, setAngle, "degrees")}
        {slider("Speed", speed, 1, kind.maxSpeed, setSpeed, "m/s")}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={over || busy} onClick={launch}>Launch</button>
        </div>
      </div>
    </Shell>
  );
}
