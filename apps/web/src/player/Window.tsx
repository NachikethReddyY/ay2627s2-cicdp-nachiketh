import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { FOCUS } from "./ui";
import type { Kind, Rect } from "./useWindows";

const MS = 260; // keep in sync with .win-morph in index.css

type Props = {
  id: string;
  label: string; // window name, e.g. "Code"
  title: string; // visible title text
  tone: string;
  hidden: boolean;
  dockId: string; // data-dock-id of the dock button this window tucks into
  fill: "zoom" | "full" | null;
  dragging: boolean; // no morph while the user drags or resizes
  rect?: Rect & { z: number }; // desktop only; undefined = stacked phone layout
  onClose(): void;
  onMinimize(): void;
  onZoom(): void;
  onFull(): void;
  onFront(): void;
  onDrag(kind: Kind, e: PointerEvent): void;
  onNudge(kind: Kind, dx: number, dy: number): void;
  onPointerMove?(): void;
  titleExtra?: ReactNode; // right side of the title bar (not a drag area)
  children: ReactNode;
};

const glyphs = {
  close: <path d="M2 2l6 6M8 2L2 8" />,
  minimize: <path d="M2 5h6" />,
  enter: <path d="M6 2h2v2M8 2L5.5 4.5M4 8H2V6M2 8l2.5-2.5" />,
  exit: <path d="M5.5 2v2.5H8M5.5 4.5L8 2M4.5 8V5.5H2M4.5 5.5L2 8" />,
};

function Light({ kind, label, color, disabled, onClick }: { kind: keyof typeof glyphs; label: string; color: string; disabled?: boolean; onClick(): void }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className={`grid size-6 place-items-center rounded-full ${FOCUS}`}>
      <span className={`grid size-3.5 place-items-center rounded-full border border-black/15 ${disabled ? "bg-[var(--track)]" : color}`}>
        {!disabled && (
          <svg
            aria-hidden="true"
            viewBox="0 0 10 10"
            className="size-3 fill-none stroke-black/60 stroke-[1.8] opacity-0 group-hover/lights:opacity-100 group-has-focus-visible/lights:opacity-100"
          >
            {glyphs[kind]}
          </svg>
        )}
      </span>
    </button>
  );
}

// Corners sit over the lines' ends; the edges are the lines between them.
const HANDLES: [Kind, string, string][] = [
  ["nw", "top-0 left-0 size-3", "cursor-nwse-resize"],
  ["ne", "top-0 right-0 size-3", "cursor-nesw-resize"],
  ["sw", "bottom-0 left-0 size-3", "cursor-nesw-resize"],
  ["se", "bottom-0 right-0 size-3", "cursor-nwse-resize"],
  ["n", "top-0 inset-x-3 h-2", "cursor-ns-resize"],
  ["s", "bottom-0 inset-x-3 h-2", "cursor-ns-resize"],
  ["w", "inset-y-3 left-0 w-2", "cursor-ew-resize"],
  ["e", "inset-y-3 right-0 w-2", "cursor-ew-resize"],
];

const STEP = 24;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };

/** A macOS-style window: absolutely positioned on desktop, a plain stacked card on phones. */
export default function Window(p: Props) {
  const { id, label, rect, hidden, dockId } = p;
  const full = p.fill === "full";
  const ref = useRef<HTMLElement>(null);
  const [gone, setGone] = useState(hidden); // display:none, only after the tuck animation ends
  const [tuck, setTuck] = useState<{ dx: number; dy: number } | null>(hidden ? { dx: 0, dy: 0 } : null);
  const hasRect = !!rect;
  useEffect(() => {
    if (!hasRect) return;
    let f2 = 0;
    let t = 0;
    const f1 = requestAnimationFrame(() => {
      if (!hidden) {
        setGone(false);
        f2 = requestAnimationFrame(() => setTuck(null)); // one frame later so the transition runs from the dock
        return;
      }
      // Vector from the window centre to the dock button centre (offset* ignore transforms).
      const el = ref.current;
      const d = document.querySelector(`[data-dock-id="${dockId}"]`)?.getBoundingClientRect();
      const a = el?.offsetParent?.getBoundingClientRect();
      setTuck(el && d && a ? { dx: d.left + d.width / 2 - (a.left + el.offsetLeft + el.offsetWidth / 2), dy: d.top + d.height / 2 - (a.top + el.offsetTop + el.offsetHeight / 2) } : { dx: 0, dy: 0 });
      t = window.setTimeout(() => setGone(true), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : MS + 40);
    });
    return () => {
      cancelAnimationFrame(f1);
      cancelAnimationFrame(f2);
      clearTimeout(t);
    };
  }, [hidden, dockId, hasRect]);
  const onMoveKey = (e: KeyboardEvent) => {
    const d = ARROWS[e.key];
    if (!d) return;
    e.preventDefault();
    p.onNudge(e.shiftKey ? "se" : "move", d[0], d[1]);
  };
  const onBarDown = (e: PointerEvent) => {
    if (rect && !(e.target as HTMLElement).closest("[data-nodrag]")) p.onDrag("move", e);
  };

  return (
    <section
      id={id}
      ref={ref}
      hidden={rect ? gone : hidden}
      inert={hidden}
      aria-labelledby={`${id}-title`}
      onPointerDown={rect ? p.onFront : undefined}
      onPointerMove={p.onPointerMove}
      style={
        rect
          ? {
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              zIndex: rect.z,
              transform: tuck ? `translate(${tuck.dx}px, ${tuck.dy}px) scale(.08)` : undefined,
              opacity: tuck ? 0 : 1,
            }
          : undefined
      }
      className={`flex min-h-0 min-w-0 flex-col chunk overflow-hidden text-ink ${full ? "rounded-none border-0 shadow-none" : "rounded-2xl"} ${rect ? `absolute ${p.dragging ? "" : "win-morph"}` : ""}`}
    >
      <div
        onPointerDown={onBarDown}
        onDoubleClick={(e) => rect && !full && !(e.target as HTMLElement).closest("[data-nodrag]") && p.onZoom()}
        className={`relative flex h-10 flex-none touch-none items-center gap-1 border-b border-ink px-2 select-none ${p.tone}`}
      >
        <div data-nodrag className="group/lights hidden items-center lg:flex">
          <Light kind="close" label={`Close ${label} window`} color="bg-[var(--bad)]" onClick={p.onClose} />
          <Light kind="minimize" label={`Minimize ${label} window`} color="bg-[var(--warn)]" disabled={full} onClick={p.onMinimize} />
          <Light kind={full ? "exit" : "enter"} label={full ? "Exit full screen" : "Enter full screen"} color="bg-green" onClick={p.onFull} />
        </div>
        <h2 id={`${id}-title`} className="sr-only">
          {label}
        </h2>
        <div className="flex min-w-0 flex-1 justify-center">
          {rect ? (
            <button
              type="button"
              data-move-handle
              aria-label={`Move ${label} window. Arrow keys move, Shift plus arrow keys resize`}
              onKeyDown={onMoveKey}
              className={`min-h-6 max-w-full cursor-grab truncate rounded-md px-2 text-sm font-semibold hover:bg-[var(--hov)] ${FOCUS}`}
            >
              {p.title}
            </button>
          ) : (
            <span aria-hidden="true" className="truncate text-sm font-semibold">
              {p.title}
            </span>
          )}
        </div>
        <div data-nodrag className="flex min-w-6 items-center justify-end">
          {p.titleExtra}
        </div>
      </div>
      {p.children}
      {rect &&
        p.fill !== "full" &&
        HANDLES.map(([dir, pos, cursor]) => (
          <span
            key={dir}
            aria-hidden="true"
            onPointerDown={(e) => p.onDrag(dir, e)}
            className={`absolute ${pos} z-20 touch-none ${cursor}`}
          />
        ))}
    </section>
  );
}
