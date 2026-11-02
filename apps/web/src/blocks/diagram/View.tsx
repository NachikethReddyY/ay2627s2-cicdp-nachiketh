import { useEffect, useId, useRef, useState } from "react";
import { BLOCKS } from "@learnquest/ui-catalog";
import type { BlockViewProps } from "../registry.ts";
import StepControls from "../StepControls.tsx";
import { useTimeline } from "../hooks/useTimeline.ts";
import type { Timeline, TimelineState } from "@learnquest/ui-catalog";
import { FONT, LINE_H, directionFor, layoutDiagram, pathOf, wrap, type DiagramProps, type Layout, type PlacedNode } from "./layout.ts";

type Props = DiagramProps & { alt: string; timeline?: Timeline };

function Shape({ n, shape, active }: { n: PlacedNode; shape: DiagramProps["shape"]; active: boolean }) {
  const { x, y, w, h } = n;
  const c = { fill: active ? "var(--color-sun)" : "var(--color-paper)", stroke: "var(--color-ink)", strokeWidth: active ? 4 : 2 };
  if (shape === "circle") return <circle cx={x} cy={y} r={w / 2} {...c} />;
  if (shape === "diamond") return <polygon points={`${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`} {...c} />;
  const r = shape === "round" ? Math.min(h / 2, 20) : 4;
  return <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={r} {...c} />;
}

function Diagram({ block, state }: BlockViewProps<Props> & { state?: TimelineState }) {
  const p = block.props;
  const [layout, setLayout] = useState<Layout | null>(null);
  const [failed, setFailed] = useState(false);
  const marker = useId();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0); // 0 = unmeasured: top-to-bottom

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only the direction matters, so the layout reruns when the width crosses the breakpoint, not on every resize.
  const dir = directionFor(p.kind, width);
  useEffect(() => {
    let live = true;
    import("@dagrejs/dagre")
      .then((m) => live && setLayout(layoutDiagram(m.default ?? m, p, dir)))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [p, dir]);

  let body;
  if (failed) body = <p className="break-words rounded-2xl border-2 border-ink bg-white p-3 text-sm">{BLOCKS.find((m) => m.type === "diagram")!.describe(block)}</p>;
  else if (!layout) body = <div role="img" aria-label={p.alt} className="h-24 w-full rounded-2xl border-2 border-ink bg-white" />;
  else body = (
    <svg role="img" aria-label={p.alt} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height}
      style={{ maxWidth: "100%", height: "auto", aspectRatio: `${layout.width} / ${layout.height}` }}
      className="block rounded-2xl border-2 border-ink bg-white" fontSize={FONT}>
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--color-ink)" />
        </marker>
      </defs>
      {layout.edges.map((e, i) => (
        <g key={i}>
          <path d={pathOf(e.points)} fill="none" stroke="var(--color-ink)" strokeWidth={1.5} markerEnd={`url(#${marker})`} />
          {e.label && <rect x={e.lx - e.lw / 2} y={e.ly - e.lh / 2} width={e.lw} height={e.lh} rx={4} fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth={1} />}
          {e.label && <text textAnchor="middle" fill="var(--color-ink)">{wrap(e.label).map((l, k, a) => <tspan key={k} x={e.lx} y={e.ly + (k - (a.length - 1) / 2) * LINE_H} dominantBaseline="central">{l}</tspan>)}</text>}
        </g>
      ))}
      {layout.nodes.map((n) => (
        <g key={n.id}>
          <Shape n={n} shape={p.shape} active={state?.[n.id]?.active === true} />
          <text textAnchor="middle" fill="var(--color-ink)">
            {n.lines.map((l, i) => <tspan key={i} x={n.x} y={n.y + (i - (n.lines.length - 1) / 2) * LINE_H} dominantBaseline="central">{l}</tspan>)}
          </text>
        </g>
      ))}
    </svg>
  );
  return <div ref={box} className="min-w-0 max-w-full">{body}</div>;
}

function Timed({ block, timeline }: BlockViewProps<Props> & { timeline: Timeline }) {
  const tl = useTimeline(timeline);
  return (
    <div ref={tl.ref} className="min-w-0 max-w-full">
      <Diagram block={block} state={tl.state} />
      <StepControls tl={tl} />
    </div>
  );
}

export default function DiagramView({ block }: BlockViewProps<Props>) {
  const t = block.props.timeline;
  return t ? <Timed block={block} timeline={t} /> : <Diagram block={block} />;
}
