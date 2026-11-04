import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Minus, Plus, RotateCcw, RotateCw, Undo2 } from "lucide-react";
import { scene3dBlock, type Scene3dProps, type TimelineState } from "@learnquest/ui-catalog";
import type { BlockViewProps } from "../registry.ts";
import StepControls from "../StepControls.tsx";
import { useTimeline } from "../hooks/useTimeline.ts";
import { MAX_DPR, checkBudget, liveContexts, shouldStartAsPoster, touchGesture } from "./budget.ts";
import { cameraPreset, lightPreset, orbitPosition, parts, resolve, type Primitive, type Vec3 } from "./model.ts";

type Props = Scene3dProps;
type Orbit = { yaw: number; pitch: number; zoom: number };
// shortcut: three has no types here (@types/three is not a dependency), so scene objects are untyped; add @types/three to tighten.
type Object3D = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Objs = Map<string, Object3D>;

// Perf budget: <=60 objects, <=100 draw calls, <=100k triangles (budget.ts), dpr <= 2, frameloop "demand".
// shortcut: >=30 fps on a low-end phone is enforced only through those caps; it is not measured. For a dev probe, watch
// renderer.info.render (calls, triangles) in the console or add drei <Stats/> temporarily, on a real throttled device.
const hasWebGL2 = () => {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // free the probe context straight away
    return !!gl;
  } catch { return false; }
};
const slowConnection = () => shouldStartAsPoster((navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection);

const btn = "grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-white";
const textBtn = "mt-2 min-h-11 rounded-full border-2 border-ink bg-white px-4 font-extrabold";

function Prim({ p, state, ms, paused, objs }: { p: Primitive; state?: TimelineState; ms: number; paused: boolean; objs: Objs }) {
  const g = useRef<Object3D>(null);
  const r = resolve(p, state);
  const invalidate = useThree((s) => s.invalidate);
  const cur = useRef<{ pos: Vec3; rot: Vec3 }>({ pos: [...r.position], rot: [...r.rotation] });
  // Pause freezes the easing in flight; a new target in the same commit (a step reached during playback, or a Next click) clears the freeze and eases in.
  const frozen = useRef(false);
  const seen = useRef({ state, ms });
  useEffect(() => { const o = g.current; if (o) objs.set(p.id, o); return () => { objs.delete(p.id); }; }, [objs, p.id]);
  // Frameloop is "demand": a new target needs one frame to start; the loop then keeps invalidating until it arrives.
  useEffect(() => {
    const newTarget = seen.current.state !== state || seen.current.ms !== ms;
    seen.current = { state, ms };
    frozen.current = newTarget ? false : paused;
    invalidate();
  }, [invalidate, state, ms, paused]);
  // Ease towards the target; ms is 0 under reduced motion and without a timeline, which snaps instead.
  useFrame(({ invalidate: again }, dt) => {
    const o = g.current;
    if (!o || frozen.current) return;
    // Clamped so the first frame after a pause or an off-screen gap does not snap to the target.
    const step = Math.min(dt, 0.1);
    const k = ms ? 1 - Math.exp((-step * 4000) / ms) : 1;
    let left = 0;
    for (let i = 0; i < 3; i++) {
      cur.current.pos[i] = cur.current.pos[i]! + (r.position[i]! - cur.current.pos[i]!) * k;
      cur.current.rot[i] = cur.current.rot[i]! + (r.rotation[i]! - cur.current.rot[i]!) * k;
      left = Math.max(left, Math.abs(r.position[i]! - cur.current.pos[i]!), Math.abs(r.rotation[i]! - cur.current.rot[i]!));
    }
    if (left > 1e-3) again(); else { cur.current.pos = [...r.position]; cur.current.rot = [...r.rotation]; }
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

function Rig({ base, orbit, poke, labels, objs, sizes }: {
  base: Vec3; orbit: { current: Orbit }; poke: { current: () => void };
  labels: { current: Map<string, HTMLElement> }; objs: Objs; sizes: Map<string, number>;
}) {
  const vec = useRef<Object3D>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { poke.current = invalidate; invalidate(); return () => { poke.current = () => {}; }; }, [poke, invalidate]);
  useFrame(({ camera, size }) => {
    camera.position.set(...orbitPosition(base, orbit.current.yaw, orbit.current.pitch).map((c) => c * orbit.current.zoom) as Vec3);
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

const STEP = 0.15;
const ZOOM = { min: 0.5, max: 2, by: 0.8 };

function Scene({ p, desc, state, ms, paused = false }: { p: Props; desc: string; state?: TimelineState; ms: number; paused?: boolean }) {
  const cam = cameraPreset(p.camera);
  const light = lightPreset(p.lights);
  const orbit = useRef<Orbit>({ yaw: 0, pitch: 0, zoom: 1 });
  const poke = useRef<() => void>(() => {});
  const drag = useRef<{ x: number; y: number; sx: number; sy: number; touch: boolean; mode: "wait" | "orbit" } | null>(null);
  const objs = useRef<Objs>(new Map()).current;
  const labels = useRef<Map<string, HTMLElement>>(new Map());
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [lost, setLost] = useState(false);
  const [gen, setGen] = useState(0);
  const orbiting = p.controls !== false;
  // Captions sit just above their object; label primitives sit on their own position.
  const sizes = useMemo(() => new Map(p.primitives.map((x) => [x.id, x.kind === "label" ? 0 : x.size * 1.2])), [p.primitives]);
  const tagged = p.primitives.filter((x) => x.label);

  // Off-screen: frameloop "never". jsdom and old browsers have no IntersectionObserver and stay visible.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const turn = (dy: number, dp: number) => { orbit.current.yaw += dy; orbit.current.pitch += dp; poke.current(); };
  const zoom = (f: number) => { orbit.current.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, orbit.current.zoom * f)); poke.current(); };
  const reset = () => { orbit.current = { yaw: 0, pitch: 0, zoom: 1 }; poke.current(); };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "wait") {
      const g = touchGesture(e.clientX - d.sx, e.clientY - d.sy);
      if (g === "wait") return;
      if (g === "scroll") { drag.current = null; return; }
      d.mode = "orbit";
    }
    orbit.current.yaw -= (e.clientX - d.x) * 0.01;
    // Touch keeps vertical drags for scrolling the page (touch-action: pan-y), so only the mouse tilts.
    if (!d.touch) orbit.current.pitch += (e.clientY - d.y) * 0.01;
    d.x = e.clientX; d.y = e.clientY;
    poke.current();
  };
  const key = (e: KeyboardEvent) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    turn(d[0]! * STEP, d[1]! * STEP);
  };

  return (
    <div ref={root} className="min-w-0 max-w-full">
      <div className="relative">
        <div
          role="img" aria-label={p.alt} tabIndex={orbiting ? 0 : undefined}
          className="relative w-full min-w-0 max-w-full select-none overflow-hidden rounded-2xl border-2 border-ink bg-white"
          style={{ aspectRatio: "4 / 3", touchAction: "pan-y" }}
          onPointerDown={orbiting ? (e) => {
            const touch = e.pointerType === "touch";
            drag.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, touch, mode: touch ? "wait" : "orbit" };
            e.currentTarget.setPointerCapture(e.pointerId);
          } : undefined}
          onPointerMove={orbiting ? move : undefined}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onKeyDown={orbiting ? key : undefined}
        >
          <Canvas
            key={gen} frameloop={visible && !lost ? "demand" : "never"} dpr={[1, MAX_DPR]}
            camera={{ position: cam.position, fov: cam.fov }}
            onCreated={({ gl }) => {
              const c = gl.domElement;
              c.addEventListener("webglcontextlost", (e: Event) => { e.preventDefault(); setLost(true); });
              c.addEventListener("webglcontextrestored", () => setLost(false));
            }}
          >
            <ambientLight intensity={light.ambient} />
            <directionalLight position={light.at} intensity={light.key} />
            <Rig base={cam.position} orbit={orbit} poke={poke} labels={labels} objs={objs} sizes={sizes} />
            {p.primitives.map((x) => <Prim key={x.id} p={x} state={state} ms={ms} paused={paused} objs={objs} />)}
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
        {lost && (
          <div role="group" aria-label={p.alt} className="absolute inset-0 grid place-content-center justify-items-center gap-1 overflow-auto rounded-2xl border-2 border-ink bg-white p-3 text-center">
            <p className="break-words text-sm font-bold">{desc}</p>
            <button type="button" className={textBtn} onClick={() => { setLost(false); setGen((g) => g + 1); }}>Tap to reload 3D</button>
          </div>
        )}
      </div>
      <p className="sr-only">{desc}</p>
      {orbiting && (
        <div role="group" aria-label="3D view controls" className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={btn} aria-label="Rotate left" onClick={() => turn(-STEP, 0)}><RotateCcw size={18} /></button>
          <button type="button" className={btn} aria-label="Rotate right" onClick={() => turn(STEP, 0)}><RotateCw size={18} /></button>
          <button type="button" className={btn} aria-label="Zoom in" onClick={() => zoom(ZOOM.by)}><Plus size={18} /></button>
          <button type="button" className={btn} aria-label="Zoom out" onClick={() => zoom(1 / ZOOM.by)}><Minus size={18} /></button>
          <button type="button" className={btn} aria-label="Reset view" onClick={reset}><Undo2 size={18} /></button>
        </div>
      )}
    </div>
  );
}

function Timed({ p, desc, timeline }: { p: Props; desc: string; timeline: NonNullable<Props["timeline"]> }) {
  const tl = useTimeline(timeline);
  return (
    <div ref={tl.ref} className="min-w-0 max-w-full">
      <Scene p={p} desc={desc} state={tl.state} ms={tl.reduced ? 0 : timeline.steps[tl.step]!.durationMs} paused={!tl.playing} />
      {/* Captions are announced by the aria-live region inside StepControls. */}
      <StepControls tl={tl} />
    </div>
  );
}

type Status = "pending" | "poster" | "live" | "nowebgl";
const box = "min-w-0 max-w-full break-words rounded-2xl border-2 border-ink bg-white p-3 text-sm";

export default function Scene3dView({ block }: BlockViewProps<Props>) {
  const p = block.props;
  const desc = scene3dBlock.describe(block);
  const [over] = useState(() => !checkBudget(p.primitives).ok);
  const [status, setStatus] = useState<Status>(() => (typeof navigator !== "undefined" && slowConnection() ? "poster" : "pending"));
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (status === "pending" && !over) setStatus(hasWebGL2() ? "live" : "nowebgl"); }, [status, over]);
  // Only one live WebGL context per page (module-level counter); a second block falls back to its poster.
  // shortcut: a poster tapped while another scene is live stays a poster; no hand-over between blocks, upgrade if lessons need two live scenes.
  useEffect(() => {
    if (status !== "live") return;
    if (!liveContexts.acquire()) { setBusy(true); setStatus("poster"); return; }
    setHeld(true);
    return () => { liveContexts.release(); setHeld(false); };
  }, [status]);

  // Over budget: text only, there is nothing to retry. Render errors fall to BlockFrame, which shows the same text.
  if (over) return <p role="img" aria-label={p.alt} className={`${box} font-bold`}>{desc}</p>;
  if (status === "live" && held) return p.timeline ? <Timed p={p} desc={desc} timeline={p.timeline} /> : <Scene p={p} desc={desc} ms={0} />;
  const action = status === "poster" ? "Tap to load 3D" : status === "nowebgl" ? "Tap to reload 3D" : null;
  return (
    <div role="group" aria-label={p.alt} className={box}>
      <p className="font-bold">{desc}</p>
      {busy && <p className="mt-1">Another 3D view is open on this page.</p>}
      {action && <button type="button" className={textBtn} onClick={() => { setBusy(false); setStatus("pending"); }}>{action}</button>}
    </div>
  );
}
