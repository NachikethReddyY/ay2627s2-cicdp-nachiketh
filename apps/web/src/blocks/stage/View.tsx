import type { StageProps, TimelineState } from "@learnquest/ui-catalog";
import { bounceTimeline, bounceY, simulateBounce } from "@learnquest/ui-catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { BlockViewProps } from "../registry.ts";
import { useTimeline } from "../hooks/useTimeline.ts";
import { bodyState, resolve, segment } from "./model.ts";

type Props = StageProps;

function Scene({ p, state, ms }: { p: Props; state?: TimelineState; ms: number }) {
  // Tween only transform and opacity; the duration is 0 under reduced motion, which also never autoplays (see useTimeline).
  const move = { transition: ms ? `transform ${ms}ms ease, opacity ${ms}ms ease` : "none" };
  return (
    <svg role="img" aria-label={p.alt} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", maxWidth: "100%", height: "auto", aspectRatio: "1 / 1" }}
      className="block rounded-2xl border-2 border-ink bg-paper" fontSize={4}>
      <defs><pattern id="stage-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.25" fill="var(--dot, var(--color-ink))" opacity="0.22" /></pattern></defs>
      <rect width="100" height="100" fill="url(#stage-dots)" />
      {p.shapes.map((s) => {
        const a = resolve(s, state);
        const body =
          s.kind === "rect" ? <rect x={s.x} y={s.y} width={a.w} height={a.h} fill={a.fill} stroke={a.stroke} strokeWidth={2.5} />
          : s.kind === "circle" ? <circle cx={s.x} cy={s.y} r={a.r} fill={a.fill} stroke={a.stroke} strokeWidth={2.5} />
          : s.kind === "ellipse" ? <ellipse cx={s.x} cy={s.y} rx={a.w / 2} ry={a.h / 2} fill={a.fill} stroke={a.stroke} strokeWidth={2.5} />
          : s.kind === "line" ? <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={a.stroke} strokeWidth={2.5} strokeLinecap="round" />
          : null;
        return (
          <g key={s.id} style={{ transform: `translate(${a.dx}px, ${a.dy}px)`, opacity: a.opacity, ...move }}>
            {body}
            {s.label && a.labelPill && <rect x={a.label.x - Math.max(5, s.label.length * 1.8)} y={a.label.y - 2.1} width={Math.max(10, s.label.length * 3.6)} height={4.2} rx={2.1} fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth={0.8} />}
            {s.label && <text x={a.label.x} y={a.label.y} textAnchor={s.kind === "text" ? "start" : "middle"} dominantBaseline="central" fontSize={a.labelPill ? 2.75 : 4} fill={s.kind === "text" ? a.fill : a.text} stroke={s.kind === "text" || a.labelPill ? undefined : "var(--color-paper)"} strokeWidth={s.kind === "text" || a.labelPill ? undefined : 0.8} paintOrder="stroke">{s.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function StageControls({ tl, captions }: { tl: ReturnType<typeof useTimeline>; captions: string[] }) {
  const last = tl.count - 1;
  const btn = "grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-white";
  return <div className="mt-2 flex flex-col gap-2">
    <div className="flex items-center gap-2 overflow-x-auto">
      <button type="button" className={btn} aria-label="Previous step" aria-disabled={tl.step === 0} onClick={() => tl.step > 0 && tl.dispatch("prev")}><SkipBack size={18} /></button>
      <button type="button" className={btn} aria-label={tl.playing ? "Pause" : "Play"} onClick={() => tl.dispatch("toggle")}>{tl.playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button type="button" className={btn} aria-label="Next step" aria-disabled={tl.step === last} onClick={() => tl.step < last && tl.dispatch("next")}><SkipForward size={18} /></button>
      <span className="rounded-full border-2 border-ink bg-sun px-3 py-2 text-sm font-extrabold">1x</span>
      {captions.map((caption, i) => <button key={i} type="button" aria-pressed={tl.step === i} onClick={() => tl.dispatch({ goto: i })} className="shrink-0 rounded-full border-2 border-ink bg-white px-3 py-2 text-sm font-bold aria-pressed:bg-mint">{i + 1}. {caption.slice(0, 20)}</button>)}
      <input className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:w-40 focus:accent-blue" type="range" min={0} max={last} value={tl.step} aria-label="Scrub steps" onChange={(e) => tl.dispatch({ goto: Number(e.target.value) })} />
    </div>
    <p aria-live="polite" className="min-h-6 break-words text-sm font-bold">{tl.caption}</p>
  </div>;
}

function Timed({ p, timeline }: { p: Props; timeline: NonNullable<Props["timeline"]> }) {
  const tl = useTimeline(timeline);
  return (
    <div ref={tl.ref} className="min-w-0 max-w-full">
      <Scene p={p} state={tl.state} ms={tl.reduced ? 0 : timeline.steps[tl.step]!.durationMs} />
      <StageControls tl={tl} captions={timeline.steps.map((step) => step.caption)} />
    </div>
  );
}

function Bouncing({ p }: { p: Props }) {
  const physics = p.physics!;
  const simulation = useMemo(() => {
    const body = p.shapes.find((s) => s.id === physics.body)!;
    const bounce = simulateBounce({ kind: "circle", y: body.y, r: body.r! }, physics);
    return { bounce, ...bounceTimeline(bounce, physics) };
  }, [p.shapes, physics]);
  const tl = useTimeline(simulation.timeline);
  const [time, setTime] = useState(0);
  const previous = useRef(0);
  useEffect(() => {
    const range = segment(previous.current, tl.step, tl.reduced, simulation.poses);
    previous.current = tl.step;
    if (!range) {
      setTime(simulation.poses[tl.step]!);
      return;
    }
    const [from, to] = range;
    let frame = 0;
    let started: number | null = null;
    const animate = (now: number) => {
      started ??= now;
      const next = Math.min(to, from + (now - started) / 1000);
      setTime(next);
      if (next < to) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [tl.step, tl.reduced, simulation.poses]);
  return <div ref={tl.ref} className="min-w-0 max-w-full">
    <Scene p={p} state={bodyState(physics.body, bounceY(simulation.bounce, time))} ms={0} />
    <StageControls tl={tl} captions={simulation.timeline.steps.map((step) => step.caption)} />
  </div>;
}

export default function StageView({ block }: BlockViewProps<Props>) {
  const p = block.props;
  return p.physics ? <Bouncing p={p} /> : p.timeline ? <Timed p={p} timeline={p.timeline} /> : <Scene p={p} ms={0} />;
}
