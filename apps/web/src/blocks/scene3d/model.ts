// Pure helpers for the scene3d renderer: presets, primitive -> mesh props, budget. No React, three or DOM, so node --test can run it.
import { MAX_PRIMITIVES, vec3Value, type Scene3dProps, type TimelineState } from "@learnquest/ui-catalog";

export type Vec3 = [number, number, number];
export type Primitive = Scene3dProps["primitives"][number];

// Hex copies of the --color-* tokens in index.css (three cannot read CSS variables).
export const HEX: Record<string, string> = {
  ink: "#1b1b1f", paper: "#fffdf8", green: "#22c55e", "green-deep": "#15803d", blue: "#3b5bff",
  sun: "#ffd23f", pink: "#ff8fb1", lilac: "#b9a4ff", mint: "#b6f0cf",
};

// "top" sits a hair off the pole so lookAt keeps a defined up vector.
export const CAMERA_PRESETS: Record<Scene3dProps["camera"], { position: Vec3; fov: number }> = {
  front: { position: [0, 0, 14], fov: 45 },
  top: { position: [0, 14, 0.01], fov: 45 },
  side: { position: [14, 0, 0], fov: 45 },
  iso: { position: [9, 8, 9], fov: 45 },
};

export const LIGHT_PRESETS: Record<Scene3dProps["lights"], { ambient: number; key: number; at: Vec3 }> = {
  soft: { ambient: 0.9, key: 0.5, at: [5, 8, 6] },
  bright: { ambient: 0.6, key: 1.6, at: [6, 10, 8] },
  dim: { ambient: 0.3, key: 0.6, at: [4, 6, 5] },
};

export const cameraPreset = (name: string) => CAMERA_PRESETS[name as keyof typeof CAMERA_PRESETS] ?? CAMERA_PRESETS.iso;
export const lightPreset = (name: string) => LIGHT_PRESETS[name as keyof typeof LIGHT_PRESETS] ?? LIGHT_PRESETS.soft;

const MAX_PITCH = 1.5;
/** Preset camera position turned by yaw/pitch (radians) around the origin; pitch is clamped short of the poles. */
export function orbitPosition(base: Vec3, yaw: number, pitch: number): Vec3 {
  const r = Math.hypot(...base);
  const theta = Math.atan2(base[0], base[2]) + yaw;
  const phi = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, Math.asin(base[1] / r) + pitch));
  return [r * Math.cos(phi) * Math.sin(theta), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(theta)];
}

export const budget = (p: Pick<Scene3dProps, "primitives">) => {
  const labels = p.primitives.filter((x) => x.kind === "label").length;
  return { total: p.primitives.length, labels, meshes: p.primitives.length - labels, ok: p.primitives.length <= MAX_PRIMITIVES };
};

export type Resolved = { position: Vec3; rotation: Vec3; color: string; opacity: number };
const RAD = Math.PI / 180;

/** Authored values overlaid with the timeline state; rotation comes back in radians. */
export function resolve(p: Primitive, state: TimelineState | undefined): Resolved {
  const t = state?.[p.id];
  const color = typeof t?.color === "string" ? HEX[t.color] : undefined;
  const op = t?.opacity;
  return {
    position: vec3Value(t?.position, 10) ?? p.position,
    rotation: ((vec3Value(t?.rotation, 360) ?? p.rotation ?? [0, 0, 0]).map((d) => d * RAD)) as Vec3,
    color: color ?? HEX[p.color]!,
    opacity: typeof op === "number" && Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : 1,
  };
}

export type Part = { geo: "sphere" | "box" | "cylinder" | "cone" | "torus" | "plane"; args: number[]; offset: Vec3 };

/** Geometry for a primitive. Labels have no mesh; arrows are a shaft plus a head along +y; lines run along x. */
export function parts(kind: Primitive["kind"], s: number): Part[] {
  switch (kind) {
    case "sphere": return [{ geo: "sphere", args: [s, 24, 16], offset: [0, 0, 0] }];
    case "box": return [{ geo: "box", args: [s, s, s], offset: [0, 0, 0] }];
    case "cylinder": return [{ geo: "cylinder", args: [s, s, s * 2, 24], offset: [0, 0, 0] }];
    case "cone": return [{ geo: "cone", args: [s, s * 2, 24], offset: [0, 0, 0] }];
    case "torus": return [{ geo: "torus", args: [s, s * 0.3, 12, 32], offset: [0, 0, 0] }];
    case "plane": return [{ geo: "plane", args: [s, s], offset: [0, 0, 0] }];
    case "arrow": return [
      { geo: "cylinder", args: [s * 0.05, s * 0.05, s * 0.7, 12], offset: [0, s * 0.35, 0] },
      { geo: "cone", args: [s * 0.15, s * 0.3, 12], offset: [0, s * 0.85, 0] },
    ];
    case "line": return [{ geo: "box", args: [s, Math.max(0.03, s * 0.02), Math.max(0.03, s * 0.02)], offset: [0, 0, 0] }];
    case "label": return [];
  }
}
