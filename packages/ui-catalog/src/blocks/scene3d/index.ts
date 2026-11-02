import { z } from "zod";
import { THEME_COLORS, alt, color, id } from "../../core/caps.ts";
import type { BlockModule, Issue } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";
import { MAX_STEPS, timelineSchema, type Timeline } from "../../core/timeline.ts";

export const MAX_PRIMITIVES = 60;
export const MAX_GROUPS = 10;
export const KINDS = ["sphere", "box", "cylinder", "cone", "torus", "plane", "arrow", "line", "label"] as const;
export const MATERIALS = ["matte", "glossy", "wire"] as const;
export const CAMERAS = ["front", "top", "side", "iso"] as const;
export const LIGHTS = ["soft", "bright", "dim"] as const;
/** Props a timeline may set. Anything else is rejected. */
export const ANIMATABLE = ["position", "rotation", "color", "opacity"] as const;

type Vec3 = [number, number, number];
type Primitive = {
  id: string;
  kind: (typeof KINDS)[number];
  position: Vec3;
  size: number;
  color: (typeof THEME_COLORS)[number];
  material: (typeof MATERIALS)[number];
  label?: string;
  rotation?: Vec3;
};
export type Scene3dProps = {
  alt: string;
  primitives: Primitive[];
  groups?: { id: string; name: string; children: string[] }[];
  camera: (typeof CAMERAS)[number];
  lights: (typeof LIGHTS)[number];
  controls?: boolean;
  timeline?: Timeline;
};

const vec3 = (lim: number) => z.tuple([z.number().min(-lim).max(lim), z.number().min(-lim).max(lim), z.number().min(-lim).max(lim)]);
/** Timeline values are scalars, so a vector is the string "x,y,z". Returns null when malformed or out of range. */
export const vec3Value = (v: unknown, lim: number): Vec3 | null => {
  const n = typeof v === "string" ? v.split(",").map((x) => (x.trim() === "" ? NaN : Number(x))) : [];
  return n.length === 3 && n.every((x) => Number.isFinite(x) && Math.abs(x) <= lim) ? (n as Vec3) : null;
};

export const scene3dBlock: BlockModule<Scene3dProps> = {
  type: "scene3d",
  schema: z.strictObject({
    alt: alt(),
    primitives: z
      .array(
        z.strictObject({
          id: id(),
          kind: z.enum(KINDS),
          position: vec3(10),
          size: z.number().min(0.05).max(5),
          color: color(),
          material: z.enum(MATERIALS),
          label: text(40).optional(),
          rotation: vec3(360).optional(),
        }),
      )
      .min(1)
      .max(MAX_PRIMITIVES),
    groups: z.array(z.strictObject({ id: id(), name: text(40), children: z.array(id()).min(1).max(MAX_PRIMITIVES) })).max(MAX_GROUPS).optional(),
    camera: z.enum(CAMERAS),
    lights: z.enum(LIGHTS),
    controls: z.boolean().optional(),
    timeline: timelineSchema.optional(),
  }),
  check: (b) => {
    const issues: Issue[] = [];
    const bad = (path: string, message: string) => issues.push({ path: `props.${path}`, message });
    const prims = new Set<string>();
    b.props.primitives.forEach((p, i) => {
      if (prims.has(p.id)) bad(`primitives.${i}.id`, `duplicate primitive id "${p.id}"`);
      prims.add(p.id);
      if (p.kind === "label" && p.label === undefined) bad(`primitives.${i}.label`, "label primitives need label");
    });
    const groups = new Set<string>();
    b.props.groups?.forEach((g, i) => {
      if (groups.has(g.id) || prims.has(g.id)) bad(`groups.${i}.id`, `duplicate id "${g.id}"`);
      groups.add(g.id);
      g.children.forEach((c, j) => {
        if (!prims.has(c)) bad(`groups.${i}.children.${j}`, groups.has(c) || b.props.groups?.some((x) => x.id === c) ? `group "${g.id}" cannot contain group "${c}"` : `unknown primitive "${c}"`);
      });
    });
    b.props.timeline?.steps.forEach((step, i) =>
      step.set.forEach((set, j) => {
        const at = `timeline.steps.${i}.set.${j}`;
        if (!prims.has(set.id)) return bad(`${at}.id`, `unknown primitive "${set.id}"`);
        const prop = set.prop as (typeof ANIMATABLE)[number];
        if (!ANIMATABLE.includes(prop)) return bad(`${at}.prop`, `"${set.prop}" cannot be animated (allowed: ${ANIMATABLE.join(", ")})`);
        const v = set.value;
        if (prop === "color") {
          if (typeof v !== "string" || !(THEME_COLORS as readonly string[]).includes(v)) bad(`${at}.value`, "color must be a theme colour");
        } else if (prop === "opacity") {
          if (typeof v !== "number" || !(v >= 0 && v <= 1)) bad(`${at}.value`, "opacity must be between 0 and 1");
        } else if (!vec3Value(v, prop === "position" ? 10 : 360)) {
          bad(`${at}.value`, `${prop} must be "x,y,z" with each number between -${prop === "position" ? 10 : 360} and ${prop === "position" ? 10 : 360}`);
        }
      }),
    );
    return issues;
  },
  describe: (b) => {
    const { alt: a, primitives, groups, camera, timeline } = b.props;
    const list = primitives.map((p) => (p.label ? `${p.label} (${p.kind})` : p.kind)).join(", ");
    const grp = groups?.length ? ` Groups: ${groups.map((g) => g.name).join(", ")}.` : "";
    const steps = timeline ? ` Over ${timeline.steps.length} steps: ${timeline.steps.map((s, i) => `${i + 1}. ${s.caption}`).join(" ")}` : "";
    return `3D scene: ${a}. Objects: ${list}.${grp} Camera: ${camera} view.${steps}`;
  },
  prompt: `Use \`scene3d\` for spatial or 3D structure: cells, atoms, geometry, models of objects. Do not use it for flat charts (use \`chart\`) or 2D drawings (use \`stage\`). \`alt\` is required: say what the scene shows. \`primitives\` (up to ${MAX_PRIMITIVES}, labels included) have id, kind (${KINDS.join(", ")}), position [x,y,z] each -10 to 10, size 0.05 to 5, color (theme colour), material (${MATERIALS.join(", ")}), optional label (up to 40 chars; label kind needs it) and optional rotation [x,y,z] in degrees (-360 to 360). Optional \`groups\` (up to ${MAX_GROUPS}, one level) are {id, name, children: primitive ids}. \`camera\` is ${CAMERAS.join(", ")}; \`lights\` is ${LIGHTS.join(", ")}; \`controls\` (default true) lets the learner orbit. Optional \`timeline\` (up to ${MAX_STEPS} steps) uses the stage format; prop is one of ${ANIMATABLE.join(", ")}: opacity is 0 to 1, color is a theme colour, position and rotation are a string "x,y,z" using the same ranges.
Example: {"type":"scene3d","id":"cell","props":{"alt":"A plant cell with a nucleus inside","primitives":[{"id":"wall","kind":"box","position":[0,0,0],"size":4,"color":"green","material":"wire"},{"id":"nuc","kind":"sphere","position":[0,0,0],"size":1,"color":"pink","material":"glossy","label":"Nucleus"}],"groups":[{"id":"cell","name":"Cell","children":["wall","nuc"]}],"camera":"iso","lights":"soft","timeline":{"steps":[{"caption":"The whole cell","durationMs":1000,"set":[]},{"caption":"The nucleus moves aside","durationMs":1500,"set":[{"id":"nuc","prop":"position","value":"1,0,0"}]}]}}}`,
  budget: 2,
};
