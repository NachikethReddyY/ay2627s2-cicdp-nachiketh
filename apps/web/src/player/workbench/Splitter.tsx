import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { KEY_STEP } from "../terminal/usePanel";

type Props = {
  /** "vertical" is a bar between columns (drags left/right); "horizontal" is a bar between rows. */
  orientation: "vertical" | "horizontal";
  label: string;
  value: number;
  min: number;
  max: number;
  onResize(px: number): void;
  /** The panel sits after the bar (right or below), so dragging toward it shrinks it. */
  after?: boolean;
};

// A resize handle with the terminal's contract: pointer-capture drag, arrow keys move KEY_STEP px.
export default function Splitter({ orientation, label, value, min, max, onResize, after = false }: Props) {
  const drag = useRef<{ start: number; value: number } | null>(null);
  const vertical = orientation === "vertical";
  const sign = after ? -1 : 1;
  const pos = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: pos(e), value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onResize(d.value + sign * (pos(e) - d.start));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const [less, more] = vertical ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (e.key !== less && e.key !== more) return;
    e.preventDefault();
    onResize(value + (e.key === more ? sign : -sign) * KEY_STEP);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(Math.max(min, max))}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={`${vertical ? "wb-split-v" : "wb-split-h"} touch-none`}
    >
      <span aria-hidden="true" className={`pointer-events-none flex gap-1 ${vertical ? "flex-col" : ""}`}>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1 rounded-full bg-[var(--mu)] opacity-60" />
        ))}
      </span>
    </div>
  );
}
