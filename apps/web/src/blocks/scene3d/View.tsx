import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { scene3dBlock, type Scene3dProps, type TimelineState } from "@learnquest/ui-catalog";
import type { BlockViewProps } from "../registry.ts";
import StepControls from "../StepControls.tsx";
import { useTimeline } from "../hooks/useTimeline.ts";
import { budget, cameraPreset, lightPreset, orbitPosition, parts, resolve, type Primitive, type Vec3 } from "./model.ts";

type Props = Scene3dProps;
type Orbit = { yaw: number; pitch: number };
// shortcut: three has no types here (@types/three is not a dependency), so scene objects are untyped; add @types/three to tighten.
type Object3D = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Objs = Map<string, Object3D>;

const hasWebGL = () => {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
};

function Prim({ p, state, ms, objs }: { p: Primitive; state?: TimelineState; ms: number; objs: Objs }) {
  const g = useRef<Object3D>(null);
  const r = resolve(p, state);
  const cur = useRef<{ pos: Vec3; rot: Vec3 }>({ pos: [...r.position], rot: [...r.rotation] });
  useEffect(() => { const o = g.current; if (o) objs.set(p.id, o); return () => { objs.delete(p.id); }; }, [objs, p.id]);
  // Ease towards the target; ms is 0 under reduced motion and without a timeline, which snaps instead.
  useFrame((_, dt) => {
    const o = g.current;
    if (!o) return;
    const k = ms ? 1 - Math.exp((-dt * 4000) / ms) : 1;
    for (let i = 0; i < 3; i++) {
      cur.current.pos[i] = cur.current.pos[i]! + (r.position[i]! - cur.current.pos[i]!) * k;
      cur.current.rot[i] = cur.current.rot[i]! + (r.rotation[i]! - cur.current.rot[i]!) * k;
    }
    o.position.set(...cur.current.pos);
    o.rotation.set(...cur.current.rot);
  });
  return (
    <group ref={g} position={r.position} rotation={r.rotation}>
      {parts(p.kind, p.size).map((part, i) => (
        <mesh key={i} position={part.offset}>
          {part.geo === "sphere" ? <sphereGeometry args={part.args as [number, number, number]} />
            : part.geo === "box" ? <boxGeometry args={part.args as [number, number, number]} />
            : part.geo === "cylinder" ? <cylinderGeometry args={part.args as [number, number, number, number]} />
            : part.geo === "cone" ? <coneGeometry args={part.args as [number, number, number]} />
            : part.geo === "torus" ? <torusGeometry args={part.args as [number, number, number, number]} />
            : <planeGeometry args={part.args as [number, number]} />}
          {p.material === "wire" ? <meshBasicMaterial color={r.color} wireframe transparent={r.opacity < 1} opacity={r.opacity} />
            : <meshStandardMaterial color={r.color} roughness={p.material === "glossy" ? 0.2 : 1} metalness={p.material === "glossy" ? 0.1 : 0}
                transparent={r.opacity < 1} opacity={r.opacity} side={p.kind === "plane" ? 2 : 0} />}
        </mesh>
      ))}
    </group>
  );
}

function Rig({ base, orbit, labels, objs, sizes }: {
  base: Vec3; orbit: { current: Orbit };
  labels: { current: Map<string, HTMLElement> }; objs: Objs; sizes: Map<string, number>;
}) {
  const vec = useRef<Object3D>(null);
  useFrame(({ camera, size }) => {
    camera.position.set(...orbitPosition(base, orbit.current.yaw, orbit.current.pitch));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const v = (vec.current ??= camera.position.clone());
    // Labels are React text in an overlay; their screen position follows the (animated) object.
    labels.current.forEach((el, id) => {
      const o = objs.get(id);
      if (!o) return;
      v.copy(o.position);
      v.y += sizes.get(id) ?? 0;
      v.project(camera);
      el.style.visibility = v.z > 1 ? "hidden" : "visible";
      el.style.transform = `translate(-50%, -50%) translate(${(v.x * 0.5 + 0.5) * size.width}px, ${(-v.y * 0.5 + 0.5) * size.height}px)`;
    });
  });
  return null;
}

function Scene({ p, state, ms }: { p: Props; state?: TimelineState; ms: number }) {
  const cam = cameraPreset(p.camera);
  const light = lightPreset(p.lights);
  const orbit = useRef<Orbit>({ yaw: 0, pitch: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const objs = useRef<Objs>(new Map()).current;
  const labels = useRef<Map<string, HTMLElement>>(new Map());
  const orbiting = p.controls !== false;
  // Captions sit just above their object; label primitives sit on their own position.
  const sizes = useMemo(() => new Map(p.primitives.map((x) => [x.id, x.kind === "label" ? 0 : x.size * 1.2])), [p.primitives]);
  const tagged = p.primitives.filter((x) => x.label);

  const move = (e: PointerEvent) => {
    if (!drag.current) return;
    orbit.current.yaw -= (e.clientX - drag.current.x) * 0.01;
    // Touch keeps vertical drags for scrolling the page (touch-action: pan-y), so only the mouse tilts.
    if (e.pointerType === "mouse") orbit.current.pitch += (e.clientY - drag.current.y) * 0.01;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const key = (e: KeyboardEvent) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    orbit.current.yaw += d[0]! * 0.15;
    orbit.current.pitch += d[1]! * 0.15;
  };

  return (
    <div
      role="img" aria-label={p.alt} tabIndex={orbiting ? 0 : undefined}
      className="relative w-full min-w-0 max-w-full select-none overflow-hidden rounded-2xl border-2 border-ink bg-white"
      style={{ aspectRatio: "4 / 3", touchAction: "pan-y" }}
      onPointerDown={orbiting ? (e) => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); } : undefined}
      onPointerMove={orbiting ? move : undefined}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={orbiting ? key : undefined}
    >
      <Canvas camera={{ position: cam.position, fov: cam.fov }} dpr={[1, 2]}>
        <ambientLight intensity={light.ambient} />
        <directionalLight position={light.at} intensity={light.key} />
        <Rig base={cam.position} orbit={orbit} labels={labels} objs={objs} sizes={sizes} />
        {p.primitives.map((x) => <Prim key={x.id} p={x} state={state} ms={ms} objs={objs} />)}
      </Canvas>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {tagged.map((x) => (
          <span key={x.id} ref={(el) => { if (el) labels.current.set(x.id, el); else labels.current.delete(x.id); }}
            className="absolute left-0 top-0 max-w-[40%] break-words rounded-full border-2 border-ink bg-paper px-2 text-xs font-extrabold"
            style={{ opacity: resolve(x, state).opacity, visibility: "hidden" }}>
            {x.label}
          </span>
        ))}
      </div>
    </div>
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

export default function Scene3dView({ block }: BlockViewProps<Props>) {
  const p = block.props;
  const [ok] = useState(() => budget(p).ok && hasWebGL());
  // Without WebGL (or over budget) show what describe() says instead. Render errors fall to BlockFrame, which shows the same text.
  if (!ok) return <p role="img" aria-label={p.alt} className="break-words rounded-2xl border-2 border-ink bg-white p-3 text-sm font-bold">{scene3dBlock.describe(block)}</p>;
  return p.timeline ? <Timed p={p} timeline={p.timeline} /> : <Scene p={p} ms={0} />;
}
