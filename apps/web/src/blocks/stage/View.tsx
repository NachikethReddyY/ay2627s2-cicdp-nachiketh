import type { StageProps, TimelineState } from "@learnquest/ui-catalog";
import { bounceTimeline, bounceY, simulateBounce } from "@learnquest/ui-catalog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockViewProps } from "../registry.ts";
import StepControls from "../StepControls.tsx";
import { useTimeline } from "../hooks/useTimeline.ts";
import { bodyState, resolve, segment } from "./model.ts";

type Props = StageProps;

function Scene({ p, state, ms }: { p: Props; state?: TimelineState; ms: number }) {
  // Tween only transform and opacity; the duration is 0 under reduced motion, which also never autoplays (see useTimeline).
  const move = { transition: ms ? `transform ${ms}ms ease, opacity ${ms}ms ease` : "none" };
  return (
    <svg role="img" aria-label={p.alt} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", maxWidth: "100%", height: "auto", aspectRatio: "1 / 1" }}
      className="block rounded-2xl border-2 border-ink bg-white" fontSize={4}>
      {p.shapes.map((s) => {
        const a = resolve(s, state);
        const body =
          s.kind === "rect" ? <rect x={s.x} y={s.y} width={a.w} height={a.h} fill={a.fill} stroke={a.stroke} strokeWidth={0.6} />
          : s.kind === "circle" ? <circle cx={s.x} cy={s.y} r={a.r} fill={a.fill} stroke={a.stroke} strokeWidth={0.6} />
          : s.kind === "ellipse" ? <ellipse cx={s.x} cy={s.y} rx={a.w / 2} ry={a.h / 2} fill={a.fill} stroke={a.stroke} strokeWidth={0.6} />
          : s.kind === "line" ? <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} stroke={a.stroke} strokeWidth={0.8} strokeLinecap="round" />
          : null;
        return (
          <g key={s.id} style={{ transform: `translate(${a.dx}px, ${a.dy}px)`, opacity: a.opacity, ...move }}>
            {body}
            {s.label && (
              <text x={a.label.x} y={a.label.y} textAnchor={s.kind === "text" ? "start" : "middle"} dominantBaseline="central"
                fill={s.kind === "text" ? a.fill : "var(--color-ink)"} stroke={s.kind === "text" ? undefined : "var(--color-paper)"} strokeWidth={s.kind === "text" ? undefined : 0.8} paintOrder="stroke">
                {s.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Timed({ p, timeline }: { p: Props; timeline: NonNullable<Props["timeline"]> }) {
  const tl = useTimeline(timeline);
  return (
    <div ref={tl.ref} className="min-w-0 max-w-full">
      <Scene p={p} state={tl.state} ms={tl.reduced ? 0 : timeline.steps[tl.step]!.durationMs} />
      <StepControls tl={tl} />
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
    <StepControls tl={tl} />
  </div>;
}

export default function StageView({ block }: BlockViewProps<Props>) {
  const p = block.props;
  return p.physics ? <Bouncing p={p} /> : p.timeline ? <Timed p={p} timeline={p.timeline} /> : <Scene p={p} ms={0} />;
}
