import { useEffect, useId, useState } from "react";
import { BLOCKS } from "@learnquest/ui-catalog";
import type { BlockViewProps } from "../registry.ts";
import { FONT, LINE_H, layoutDiagram, pathOf, type DiagramProps, type Layout, type PlacedNode } from "./layout.ts";

type Props = DiagramProps & { alt: string };

// shortcut: no timeline highlighting; the diagram module has no timeline field yet, wire useTimeline when it does
function Shape({ n, shape }: { n: PlacedNode; shape: DiagramProps["shape"] }) {
  const { x, y, w, h } = n;
  const c = { fill: "var(--color-paper)", stroke: "var(--color-ink)", strokeWidth: 2 };
  if (shape === "circle") return <circle cx={x} cy={y} r={w / 2} {...c} />;
  if (shape === "diamond") return <polygon points={`${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`} {...c} />;
  const r = shape === "round" ? Math.min(h / 2, 20) : 4;
  return <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={r} {...c} />;
}

export default function DiagramView({ block }: BlockViewProps<Props>) {
  const p = block.props;
  const [layout, setLayout] = useState<Layout | null>(null);
  const [failed, setFailed] = useState(false);
  const marker = useId();

  useEffect(() => {
    let live = true;
    import("@dagrejs/dagre")
      .then((m) => live && setLayout(layoutDiagram(m.default ?? m, p)))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [p]);

  if (failed) return <p className="break-words rounded-2xl border-2 border-ink bg-white p-3 text-sm">{BLOCKS.find((m) => m.type === "diagram")!.describe(block)}</p>;
  if (!layout) return <div role="img" aria-label={p.alt} className="h-24 w-full rounded-2xl border-2 border-ink bg-white" />;

  return (
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
          {e.label && <text x={e.lx} y={e.ly} textAnchor="middle" dominantBaseline="central" fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth={4} paintOrder="stroke">{e.label}</text>}
        </g>
      ))}
      {layout.nodes.map((n) => (
        <g key={n.id}>
          <Shape n={n} shape={p.shape} />
          <text textAnchor="middle" fill="var(--color-ink)">
            {n.lines.map((l, i) => <tspan key={i} x={n.x} y={n.y + (i - (n.lines.length - 1) / 2) * LINE_H} dominantBaseline="central">{l}</tspan>)}
          </text>
        </g>
      ))}
    </svg>
  );
}
