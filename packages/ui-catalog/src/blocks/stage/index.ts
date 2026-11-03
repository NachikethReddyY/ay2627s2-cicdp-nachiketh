import { z } from "zod";
import { THEME_COLORS, alt, color, id } from "../../core/caps.ts";
import type { BlockModule, Issue } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";
import { MAX_STEPS, timelineSchema, type Timeline } from "../../core/timeline.ts";

export const MAX_SHAPES = 60;
export const KINDS = ["rect", "circle", "ellipse", "line", "text"] as const;
/** Props a timeline may set. Anything else is rejected. */
export const ANIMATABLE = ["x", "y", "opacity", "fill", "stroke", "w", "h", "r"] as const;

type Kind = (typeof KINDS)[number];
type Shape = {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  x2?: number;
  y2?: number;
  fill?: (typeof THEME_COLORS)[number];
  stroke?: (typeof THEME_COLORS)[number];
  label?: string;
};
export type StagePhysics = { kind: "bounce"; body: string; floor: number; restitution: number; autoplay?: boolean };
export type StageProps = { alt: string; shapes: Shape[]; timeline?: Timeline; physics?: StagePhysics };

// Geometry each kind needs (and may use) beyond x and y. rect x,y is the top-left corner; the others are centred or anchored at x,y.
const GEOMETRY: Record<Kind, readonly ("w" | "h" | "r" | "x2" | "y2" | "label")[]> = {
  rect: ["w", "h"],
  circle: ["r"],
  ellipse: ["w", "h"],
  line: ["x2", "y2"],
  text: ["label"],
};
const GEOMETRY_KEYS = ["w", "h", "r", "x2", "y2"] as const;

/** Returns the first field whose shape extent leaves 0..100, else undefined. Ellipse x,y is its centre (as View.tsx draws it). */
function extent(s: Shape): "x" | "y" | undefined {
  const inside = (lo: number, hi: number) => lo >= 0 && hi <= 100;
  const { x, y } = s;
  let [dx0, dx1, dy0, dy1] = [0, 0, 0, 0];
  if (s.kind === "rect") [dx1, dy1] = [s.w ?? 0, s.h ?? 0];
  else if (s.kind === "ellipse") [dx0, dx1, dy0, dy1] = [-(s.w ?? 0) / 2, (s.w ?? 0) / 2, -(s.h ?? 0) / 2, (s.h ?? 0) / 2];
  else if (s.kind === "circle") [dx0, dx1, dy0, dy1] = [-(s.r ?? 0), s.r ?? 0, -(s.r ?? 0), s.r ?? 0];
  else if (s.kind === "line") [dx0, dx1, dy0, dy1] = [Math.min(0, (s.x2 ?? x) - x), Math.max(0, (s.x2 ?? x) - x), Math.min(0, (s.y2 ?? y) - y), Math.max(0, (s.y2 ?? y) - y)];
  if (!inside(x + dx0, x + dx1)) return "x";
  return inside(y + dy0, y + dy1) ? undefined : "y";
}

const coord = () => z.number().min(0).max(100);

export const stageBlock: BlockModule<StageProps> = {
  type: "stage",
  schema: z.strictObject({
    alt: alt(),
    shapes: z
      .array(
        z.strictObject({
          id: id(),
          kind: z.enum(KINDS),
          x: coord(),
          y: coord(),
          w: coord().optional(),
          h: coord().optional(),
          r: coord().optional(),
          x2: coord().optional(),
          y2: coord().optional(),
          fill: color().optional(),
          stroke: color().optional(),
          label: text(40).optional(),
        }),
      )
      .min(1)
      .max(MAX_SHAPES),
    timeline: timelineSchema.optional(),
    physics: z.strictObject({ kind: z.literal("bounce"), body: id(), floor: coord(), restitution: z.number().min(0.2).max(0.9), autoplay: z.boolean().optional() }).optional(),
  }),
  check: (b) => {
    const issues: Issue[] = [];
    const bad = (path: string, message: string) => issues.push({ path: `props.${path}`, message });
    const kinds = new Map<string, Kind>();
    b.props.shapes.forEach((s, i) => {
      if (kinds.has(s.id)) bad(`shapes.${i}.id`, `duplicate shape id "${s.id}"`);
      kinds.set(s.id, s.kind);
      for (const k of GEOMETRY_KEYS) {
        const needed = GEOMETRY[s.kind].includes(k);
        if (needed && s[k] === undefined) bad(`shapes.${i}.${k}`, `${s.kind} shapes need ${k}`);
        if (!needed && s[k] !== undefined) bad(`shapes.${i}.${k}`, `${k} is not used by ${s.kind} shapes`);
      }
      if (s.kind === "text" && s.label === undefined) bad(`shapes.${i}.label`, "text shapes need label");
      const out = extent(s);
      if (out) bad(`shapes.${i}.${out}`, `${s.kind} shape "${s.id}" leaves the 0-100 canvas`);
    });
    // shortcut: timeline x/y are only range-checked 0..100, not the moved extent (x-r, x+w); upgrade if animated shapes clip.
    b.props.timeline?.steps.forEach((step, i) =>
      step.set.forEach((set, j) => {
        const at = `timeline.steps.${i}.set.${j}`;
        if (!kinds.has(set.id)) return bad(`${at}.id`, `unknown shape "${set.id}"`);
        const prop = set.prop as (typeof ANIMATABLE)[number];
        if (!ANIMATABLE.includes(prop)) return bad(`${at}.prop`, `"${set.prop}" cannot be animated (allowed: ${ANIMATABLE.join(", ")})`);
        const v = set.value;
        if (prop === "fill" || prop === "stroke") {
          if (typeof v !== "string" || !(THEME_COLORS as readonly string[]).includes(v)) bad(`${at}.value`, `${prop} must be a theme colour`);
        } else if (typeof v !== "number" || !Number.isFinite(v)) bad(`${at}.value`, `${prop} must be a number`);
        else if (v < 0 || v > (prop === "opacity" ? 1 : 100)) bad(`${at}.value`, `${prop} must be between 0 and ${prop === "opacity" ? 1 : 100}`);
      }),
    );
    if (b.props.physics) {
      const { body, floor } = b.props.physics;
      if (b.props.timeline) bad("physics", "use either timeline or physics, not both");
      const shape = b.props.shapes.find((s) => s.id === body);
      if (!shape) bad("physics.body", `unknown shape "${body}"`);
      else if (shape.kind !== "circle") bad("physics.body", `physics body "${body}" must be a circle`);
      else {
        if (shape.y + (shape.r ?? 0) > floor) bad("physics.floor", `ball "${body}" must start above the floor (y + r <= floor)`);
        else if (shape.y + (shape.r ?? 0) > floor - 5) bad("physics.floor", `ball "${body}" must start at least 5 above the floor`);
      }
    }
    return issues;
  },
  describe: (b) => {
    const { alt: a, shapes, timeline, physics } = b.props;
    const list = shapes.map((s) => (s.label ? `${s.label} (${s.kind})` : s.kind)).join(", ");
    const steps = timeline ? ` Over ${timeline.steps.length} steps: ${timeline.steps.map((s, i) => `${i + 1}. ${s.caption}`).join(" ")}` : "";
    const bounce = physics ? ` The ball is dropped and bounces under gravity, keeping about ${Math.round(physics.restitution ** 2 * 100)}% of its energy on each hit, until it rests.` : "";
    return `Stage: ${a}. Shapes: ${list}.${steps}${bounce}`;
  },
  prompt: `Use \`stage\` for a small animated 2D scene. \`alt\` is required: say what the scene shows. \`shapes\` (up to ${MAX_SHAPES}) sit on a 0-100 by 0-100 canvas; every number is 0 to 100. Each shape has id, kind (rect, circle, ellipse, line, text), x, y, optional fill and stroke (theme colours) and optional label (up to 40 chars). rect and ellipse need w and h (rect x,y is its top-left), circle needs r, line needs x2 and y2, text needs label.
Optional \`timeline\` (up to ${MAX_STEPS} steps): each step has caption, durationMs (300 to 4000) and set, a list of {id, prop, value} using shape ids. prop is one of ${ANIMATABLE.join(", ")}: numbers 0 to 100 (opacity 0 to 1), fill and stroke are theme colours.
Optional \`physics\` drops one circle and bounces it under real gravity (9.8 m/s², the canvas is 2 m tall): {"kind":"bounce","body":"ball","floor":80,"restitution":0.75,"autoplay":true}. restitution is 0.2 to 0.9 (0.5 dull, 0.8 lively). The ball starts at rest at its own x,y, at least 5 above the floor (y + r <= floor - 5). Steps and captions are generated, so do not add a \`timeline\`. Use \`physics\` instead of \`timeline\` for anything that falls, drops or bounces.
Example: {"type":"stage","id":"bounce","props":{"alt":"A ball bounces on the ground","shapes":[{"id":"ground","kind":"rect","x":0,"y":80,"w":100,"h":20,"fill":"green"},{"id":"ball","kind":"circle","x":50,"y":20,"r":6,"fill":"sun","label":"Ball"}],"physics":{"kind":"bounce","body":"ball","floor":80,"restitution":0.75,"autoplay":true}}}
Example: {"type":"stage","id":"ball","props":{"alt":"A ball rolls from the left to the right of the ground","shapes":[{"id":"ground","kind":"rect","x":0,"y":80,"w":100,"h":20,"fill":"green"},{"id":"ball","kind":"circle","x":15,"y":72,"r":8,"fill":"sun","stroke":"ink","label":"Ball"}],"timeline":{"steps":[{"caption":"The ball starts on the left","durationMs":1000,"set":[]},{"caption":"It rolls to the right","durationMs":1500,"set":[{"id":"ball","prop":"x","value":85}]}]}}}`,
  budget: 3,
};
