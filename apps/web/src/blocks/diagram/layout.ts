// Pure layout math for the diagram block. dagre is passed in (loaded lazily by View.tsx), never imported here.
import type Dagre from "@dagrejs/dagre";

export type DiagramProps = {
  kind: string;
  shape?: "rect" | "round" | "diamond" | "circle";
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
};
export type Pt = { x: number; y: number };
export type PlacedNode = { id: string; lines: string[]; x: number; y: number; w: number; h: number };
export type PlacedEdge = { points: Pt[]; label?: string; lx: number; ly: number };
export type Layout = { nodes: PlacedNode[]; edges: PlacedEdge[]; width: number; height: number };

export const FONT = 14;
export const CHAR_W = 8; // generous average glyph width at FONT, so text never overruns its box
export const LINE_H = 18;
const WRAP = 14; // chars per label line
const PAD = 12;
const MARGIN = 12;

/** Greedy word wrap; words longer than `max` are split so nothing exceeds it. */
export function wrap(label: string, max = WRAP): string[] {
  const lines: string[] = [];
  let cur = "";
  for (let word of label.split(/\s+/).filter(Boolean)) {
    while (word.length > max) {
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (cur && cur.length + 1 + word.length > max) { lines.push(cur); cur = word; }
    else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** Box big enough for the wrapped text; diamonds and circles need more room around it. */
export function nodeSize(lines: string[], shape: DiagramProps["shape"] = "rect"): { w: number; h: number } {
  const tw = Math.max(...lines.map((l) => l.length)) * CHAR_W;
  const th = lines.length * LINE_H;
  if (shape === "diamond") return { w: Math.ceil((tw + 2 * PAD) * 1.6), h: Math.ceil((th + 2 * PAD) * 1.6) };
  if (shape === "circle") { const d = Math.ceil(Math.hypot(tw, th) + PAD); return { w: d, h: d }; }
  return { w: Math.ceil(tw + 2 * PAD), h: Math.ceil(th + 2 * PAD) };
}

const DIR: Record<string, "TB" | "LR"> = { timeline: "LR" };

export function layoutDiagram(dagre: typeof Dagre, p: DiagramProps): Layout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: DIR[p.kind] ?? "TB", nodesep: 24, ranksep: 36, edgesep: 12, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  const boxes = new Map(p.nodes.map((n) => { const lines = wrap(n.label); return [n.id, { lines, ...nodeSize(lines, p.shape) }]; }));
  for (const [id, b] of boxes) g.setNode(id, { width: b.w, height: b.h });
  p.edges.forEach((e, i) => {
    const l = e.label ? wrap(e.label, WRAP) : undefined;
    const sz = l ? { width: Math.max(...l.map((s) => s.length)) * CHAR_W + 8, height: l.length * LINE_H + 4, labelpos: "c" } : {};
    g.setEdge(e.from, e.to, sz, String(i));
  });
  dagre.layout(g);

  const nodes = p.nodes.map((n) => {
    const d = g.node(n.id)!;
    return { id: n.id, ...boxes.get(n.id)!, x: d.x, y: d.y };
  });
  const edges = p.edges.map((e, i) => {
    const d = g.edge({ v: e.from, w: e.to, name: String(i) })!;
    return { points: d.points, label: e.label, lx: d.x ?? 0, ly: d.y ?? 0 };
  });
  const gr = g.graph();
  return { nodes, edges, width: Math.ceil(gr.width ?? 0), height: Math.ceil(gr.height ?? 0) };
}

/** SVG path through dagre's edge points. */
export const pathOf = (pts: Pt[]): string => pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ");
