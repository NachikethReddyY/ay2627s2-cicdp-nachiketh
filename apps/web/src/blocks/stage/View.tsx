import type { StageProps, TimelineState } from "@learnquest/ui-catalog";
import { bodyBelow, bounceTimeline, bounceY, simulateBounce } from "@learnquest/ui-catalog";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { BlockViewProps } from "../registry.ts";
import { useTimeline } from "../hooks/useTimeline.ts";
import { bodyState, holdTween, resolve, segment } from "./model.ts";

type Props = StageProps;

/** Tweens the numeric props of a timeline state with GSAP; text and colour props switch at the start of the step. */
const REST: Record<string, number> = { rotation: 0, scale: 1, opacity: 1, draw: 1 };

function useTweened(target: TimelineState, duration: number, ease: string, reduced: boolean, shapes: Props["shapes"], paused: boolean): TimelineState {
  const [shown, setShown] = useState(target);
  const last = useRef<Map<string, number>>(new Map());
  const tweenRef = useRef<gsap.core.Tween | null>(null);
  // Set when this commit created a tween for a new target, so the pause effect below leaves it running.
  const fresh = useRef(false);
  useEffect(() => {
    const entries: [string, string, number][] = [];
    for (const id of Object.keys(target)) for (const prop of Object.keys(target[id]!)) {
      const v = target[id]![prop];
      if (typeof v === "number") entries.push([id, prop, v]);
    }
    const key = (id: string, prop: string) => `${id}\u0000${prop}`;
    const obj: Record<string, number> = {};
    const goal: Record<string, number> = {};
    entries.forEach(([id, prop, v], i) => {
      // A prop with no earlier value starts from the shape's own value, or its rest value, not the goal, so the first move animates.
      const own = shapes.find((sh) => sh.id === id) as Record<string, unknown> | undefined;
      const base = typeof own?.[prop] === "number" ? own[prop] as number : REST[prop];
      obj[i] = last.current.get(key(id, prop)) ?? base ?? v;
      goal[i] = v;
    });
    const render = () => {
      const next: TimelineState = Object.create(null);
      for (const id of Object.keys(target)) next[id] = { ...target[id] };
      entries.forEach(([id, prop], i) => { next[id]![prop] = obj[i]!; });
      last.current = new Map(entries.map(([id, prop], i) => [key(id, prop), obj[i]!]));
      setShown(next);
    };
    if (reduced || duration <= 0 || entries.length === 0) { Object.assign(obj, goal); render(); return; }
    const tween = gsap.to(obj, { ...goal, duration: duration / 1000, ease, onUpdate: render });
    tweenRef.current = tween;
    fresh.current = true;
    return () => { tween.kill(); tweenRef.current = null; };
  }, [target, duration, ease, reduced, shapes]);
  // Pause freezes the tween in flight, on a change only so a fresh mount is not frozen. A new target in the same commit
  // (the last step reached during playback, or a Next click) is not frozen: it runs to its target.
  const pausedSeen = useRef(paused);
  useEffect(() => {
    const created = fresh.current;
    fresh.current = false;
    if (pausedSeen.current === paused) return;
    pausedSeen.current = paused;
    if (!created) holdTween(tweenRef.current, paused);
  }, [paused, target]);
  return shown;
}

function Scene({ p, state }: { p: Props; state?: TimelineState }) {
  // Several stages can share a page, and SVG ids are document-wide.
  const uid = useId().replace(/:/g, "");
  const dots = `stage-dots-${uid}`;
  const arrow = `stage-arrowhead-${uid}`;
  return (
    <svg role="img" aria-label={p.alt} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", maxWidth: "100%", height: "auto", aspectRatio: "1 / 1" }}
      className="block rounded-2xl border-2 border-ink bg-paper" fontSize={4}>
      <defs><pattern id={dots} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.25" fill="var(--dot, var(--color-ink))" opacity="0.22" /></pattern></defs>
      <rect width="100" height="100" fill={`url(#${dots})`} />
      <defs><marker id={arrow} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--color-ink)" /></marker></defs>
      {p.shapes.map((s) => {
        const a = resolve(s, state);
        const body =
          s.kind === "rect" ? <rect x={s.x} y={s.y} width={a.w} height={a.h} fill={a.fill} stroke={a.stroke} strokeWidth={2.5} />
          : s.kind === "circle" ? <circle cx={s.x} cy={s.y} r={a.r} fill={a.fill} stroke={a.stroke} strokeWidth={2.5} />
          : s.kind === "ellipse" ? <ellipse cx={s.x} cy={s.y} rx={a.w / 2} ry={a.h / 2} fill={a.fill} stroke={a.stroke} strokeWidth={2.5} />
          : s.kind === "line" ? <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={a.stroke} strokeWidth={2.5} strokeLinecap="round" markerEnd={s.arrow ? `url(#${arrow})` : undefined} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - a.draw} />
          : s.kind === "path" ? <path d={s.d} fill={a.fill} stroke={a.stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - a.draw} />
          : null;
        // Rotation and scale turn about the shape's own x,y; the offset from the state moves it first.
        const transform = `translate(${a.dx} ${a.dy}) translate(${s.x} ${s.y}) rotate(${a.rot}) scale(${a.sc}) translate(${-s.x} ${-s.y})`;
        return (
          <g key={s.id} transform={transform} opacity={a.opacity}>
            {body}
            {s.label && a.labelPill && <rect x={a.label.x - Math.max(5, s.label.length * 1.8)} y={a.label.y - 2.1} width={Math.max(10, s.label.length * 3.6)} height={4.2} rx={2.1} fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth={0.8} />}
            {s.label && <text x={a.label.x} y={a.label.y} textAnchor={s.kind === "text" ? "start" : "middle"} dominantBaseline="central" fontSize={a.labelPill ? 2.75 : 4} fill={s.kind === "text" ? a.fill : a.text} stroke={s.kind === "text" || a.labelPill ? undefined : "var(--color-paper)"} strokeWidth={s.kind === "text" || a.labelPill ? undefined : 0.8} paintOrder="stroke">{s.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function StageControls({ tl }: { tl: ReturnType<typeof useTimeline> }) {
  const last = tl.count - 1;
  const btn = "grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-white";
  return <div className="mt-2 flex flex-col gap-2">
    <div className="flex items-center gap-2 overflow-x-auto">
      <button type="button" className={btn} aria-label="Previous step" aria-disabled={tl.step === 0} onClick={() => tl.step > 0 && tl.dispatch("prev")}><SkipBack size={18} /></button>
      <button type="button" className={btn} aria-label={tl.playing ? "Pause" : "Play"} onClick={() => tl.dispatch("toggle")}>{tl.playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button type="button" className={btn} aria-label="Next step" aria-disabled={tl.step === last} onClick={() => tl.step < last && tl.dispatch("next")}><SkipForward size={18} /></button>
      <input className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:w-40 focus:accent-blue" type="range" min={0} max={last} value={tl.step} aria-label="Scrub steps" onChange={(e) => tl.dispatch({ goto: Number(e.target.value) })} />
    </div>
    <p aria-live="polite" className="min-h-6 break-words text-sm font-bold">{tl.caption}</p>
  </div>;
}

function Timed({ p, timeline }: { p: Props; timeline: NonNullable<Props["timeline"]> }) {
  const tl = useTimeline(timeline);
  const step = timeline.steps[tl.step]!;
  const shown = useTweened(tl.state, step.durationMs, step.ease ?? "none", tl.reduced, p.shapes, !tl.playing);
  return (
    <div ref={tl.ref} className="min-w-0 max-w-full">
      <Scene p={p} state={shown} />
      <StageControls tl={tl} />
    </div>
  );
}

function Bouncing({ p }: { p: Props }) {
  const physics = p.physics!;
  const simulation = useMemo(() => {
    const body = p.shapes.find((s) => s.id === physics.body)!;
    const bounce = simulateBounce({ y: body.y, below: bodyBelow(body) }, physics);
    return { bounce, ...bounceTimeline(bounce, physics) };
  }, [p.shapes, physics]);
  const tl = useTimeline(simulation.timeline);
  const [time, setTime] = useState(0);
  const timeRef = useRef(0);
  const lastStep = useRef(tl.step);
  // The frame loop only runs while on screen; its cleanup cancels the pending frame when the block scrolls away.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = tl.ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [tl.ref]);
  useEffect(() => {
    if (!visible) return; // Off screen: hold the last frame and resume from it, so a step change is not lost.
    const stepChanged = lastStep.current !== tl.step;
    lastStep.current = tl.step;
    if (!tl.playing && !tl.reduced && !stepChanged) return;
    const range = segment(tl.step, tl.playing && !tl.reduced, simulation.poses);
    if (!range) {
      const pose = simulation.poses[tl.step]!;
      timeRef.current = pose;
      setTime(pose);
      return;
    }
    const [start, to] = range;
    const from = stepChanged ? start : Math.max(start, Math.min(to, timeRef.current));
    const duration = simulation.timeline.steps[tl.step]!.durationMs;
    const remaining = to > start ? duration * ((to - from) / (to - start)) : 0; // a zero-length segment has nothing to animate
    let frame = 0;
    let started: number | null = null;
    const animate = (now: number) => {
      started ??= now;
      const next = from + (to - from) * Math.min(1, (now - started) / remaining);
      timeRef.current = next;
      setTime(next);
      if (next < to) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [visible, tl.step, tl.playing, tl.reduced, simulation.poses, simulation.timeline.steps]);
  return <div ref={tl.ref} className="min-w-0 max-w-full">
    <Scene p={p} state={bodyState(physics.body, bounceY(simulation.bounce, time))} />
    <StageControls tl={tl} />
  </div>;
}

export default function StageView({ block }: BlockViewProps<Props>) {
  const p = block.props;
  return p.physics ? <Bouncing p={p} /> : p.timeline ? <Timed p={p} timeline={p.timeline} /> : <Scene p={p} />;
}
