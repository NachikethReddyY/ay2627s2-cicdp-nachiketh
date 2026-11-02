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
export type PlacedEdge = { points: Pt[]; label?: string; lx: number; ly: number; lw: number; lh: number };
export type Layout = { nodes: PlacedNode[]; edges: PlacedEdge[]; width: number; height: number };

export const FONT = 14;
export const CHAR_W = 8; // generous average glyph width at FONT, so text never overruns its box
export const LINE_H = 18;
const WRAP = 14; // chars per edge-label line
export const NODE_WRAP = 18; // chars per node-label line
export const MIN_W = 150;
const MIN_H = 44;
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
  if (shape === "diamond") return { w: Math.max(MIN_W, Math.ceil((tw + 2 * PAD) * 1.6)), h: Math.max(MIN_H, Math.ceil((th + 2 * PAD) * 1.6)) };
  if (shape === "circle") { const d = Math.max(96, Math.ceil(Math.hypot(tw, th) + PAD)); return { w: d, h: d }; }
  return { w: Math.max(MIN_W, Math.ceil(tw + 2 * PAD)), h: Math.max(MIN_H, Math.ceil(th + 2 * PAD)) };
}

/** Point where the ray from the node centre toward `toward` crosses the node outline (rect/round: box; circle: radius; diamond: its edges). */
export function clipToShape(n: { x: number; y: number; w: number; h: number }, toward: Pt, shape: DiagramProps["shape"] = "rect"): Pt {
  const dx = toward.x - n.x, dy = toward.y - n.y;
  if (dx === 0 && dy === 0) return { x: n.x, y: n.y };
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const t = shape === "circle" ? n.w / 2 / Math.hypot(dx, dy)
    : shape === "diamond" ? 1 / (ax / (n.w / 2) + ay / (n.h / 2))
    : Math.min(ax ? n.w / 2 / ax : Infinity, ay ? n.h / 2 / ay : Infinity);
  return { x: n.x + dx * t, y: n.y + dy * t };
}

export const WIDE = 640; // container px at which flow and cycle diagrams switch to left-to-right

/** Rank direction: timelines always run across; flow and cycle run across on a wide container; everything else (and unmeasured) stays top-to-bottom. */
export function directionFor(kind: string, width: number): "TB" | "LR" {
  return kind === "timeline" || ((kind === "flow" || kind === "cycle") && width >= WIDE) ? "LR" : "TB";
}

export function layoutDiagram(dagre: typeof Dagre, p: DiagramProps, dir: "TB" | "LR" = directionFor(p.kind, 0)): Layout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: dir, nodesep: 24, ranksep: 36, edgesep: 12, marginx: MARGIN, marginy: MARGIN });
  g.setDefaultEdgeLabel(() => ({}));
  // Last resort: a label that would still wrap past 3 lines gets a wider line (up to 24 chars). The SVG scales to its container, so wide viewBoxes are fine.
  const boxes = new Map(p.nodes.map((n) => { let lines = wrap(n.label, NODE_WRAP); if (lines.length > 3) lines = wrap(n.label, Math.max(NODE_WRAP, Math.min(24, Math.ceil(n.label.length / 3) + 2))); return [n.id, { lines, ...nodeSize(lines, p.shape) }]; }));
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
    // dagre ends edges on the bounding box; pull circle/diamond ends onto the real outline.
    const points = [...d.points];
    const [a, b] = [nodes.find((n) => n.id === e.from)!, nodes.find((n) => n.id === e.to)!];
    if ((p.shape === "circle" || p.shape === "diamond") && points.length > 1) {
      points[0] = clipToShape(a, points[1], p.shape);
      points[points.length - 1] = clipToShape(b, points[points.length - 2], p.shape);
    }
    return { points, label: e.label, lx: d.x ?? 0, ly: d.y ?? 0, lw: d.width ?? 0, lh: d.height ?? 0 };
  });
  const gr = g.graph();
  return { nodes, edges, width: Math.ceil(gr.width ?? 0), height: Math.ceil(gr.height ?? 0) };
}

/** SVG path through dagre's edge points. */
export const pathOf = (pts: Pt[]): string => pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ");
