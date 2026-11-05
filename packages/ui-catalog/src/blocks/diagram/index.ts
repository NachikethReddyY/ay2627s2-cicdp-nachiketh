import { z } from "zod";
import { alt, id } from "../../core/caps.ts";
import type { BlockModule } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";
import { MAX_STEPS, timelineSchema, type Timeline } from "../../core/timeline.ts";

const MAX_NODES = 30;
const MAX_EDGES = 50;
const KINDS = ["flow", "tree", "cycle", "timeline", "graph", "labelled"] as const;
/** Props a timeline may set on a node. */
const ANIMATABLE = ["active"] as const;
const SHAPES = ["rect", "round", "diamond", "circle"] as const;

type Props = {
  kind: (typeof KINDS)[number];
  shape?: (typeof SHAPES)[number];
  alt: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
  timeline?: Timeline;
};

export const diagramBlock: BlockModule<Props> = {
  type: "diagram",
  schema: z.strictObject({
    kind: z.enum(KINDS),
    shape: z.enum(SHAPES).optional(),
    alt: alt(),
    nodes: z.array(z.strictObject({ id: id(), label: text(60) })).min(1).max(MAX_NODES),
    edges: z.array(z.strictObject({ from: id(), to: id(), label: text(40).optional() })).max(MAX_EDGES),
    timeline: timelineSchema.optional(),
  }),
  check: (b) => {
    const issues: { path: string; message: string }[] = [];
    const seen = new Set<string>();
    b.props.nodes.forEach((n, i) => {
      if (seen.has(n.id)) issues.push({ path: `props.nodes.${i}.id`, message: `duplicate node id "${n.id}"` });
      seen.add(n.id);
    });
    b.props.edges.forEach((e, i) => {
      for (const end of ["from", "to"] as const)
        if (!seen.has(e[end])) issues.push({ path: `props.edges.${i}.${end}`, message: `unknown node "${e[end]}"` });
    });
    b.props.timeline?.steps.forEach((step, i) =>
      step.set.forEach((set, j) => {
        const at = `props.timeline.steps.${i}.set.${j}`;
        if (!seen.has(set.id)) issues.push({ path: `${at}.id`, message: `unknown node "${set.id}"` });
        else if (set.prop !== "active") issues.push({ path: `${at}.prop`, message: `"${set.prop}" cannot be set (allowed: ${ANIMATABLE.join(", ")})` });
        else if (typeof set.value !== "boolean") issues.push({ path: `${at}.value`, message: "active must be true or false" });
      }),
    );
    return issues;
  },
  describe: (b) => {
    const label = new Map(b.props.nodes.map((n) => [n.id, n.label]));
    const edges = b.props.edges.map((e) => `${label.get(e.from) ?? e.from} -> ${label.get(e.to) ?? e.to}${e.label ? ` (${e.label})` : ""}`);
    const tl = b.props.timeline;
    const steps = tl ? ` Over ${tl.steps.length} steps: ${tl.steps.map((st, i) => `${i + 1}. ${st.caption}`).join(" ")}` : "";
    return `Diagram (${b.props.kind}): ${b.props.alt}. Nodes: ${b.props.nodes.map((n) => n.label).join(", ")}.${edges.length ? ` Edges: ${edges.join("; ")}.` : ""}${steps}`;
  },
  prompt: `Prefer \`diagram\` when a structure is the point: steps in a process, a hierarchy, a cycle, a timeline, relationships.
\`kind\` is flow, tree, cycle, timeline, graph or labelled. \`shape\` (rect, round, diamond, circle) is optional and applies to every node.
Up to ${MAX_NODES} nodes (id, label up to 60 chars) and ${MAX_EDGES} edges (from, to, optional label up to 40 chars); every edge must use node ids. \`alt\` is required: say what the diagram shows.
Example: {"type":"diagram","id":"water","props":{"kind":"cycle","alt":"The water cycle: evaporation, condensation, rain","nodes":[{"id":"sea","label":"Sea"},{"id":"cloud","label":"Cloud"},{"id":"rain","label":"Rain"}],"edges":[{"from":"sea","to":"cloud","label":"evaporates"},{"from":"cloud","to":"rain"},{"from":"rain","to":"sea"}]}}`,
  budget: 3,
};
