import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { resizeRect, type PreviewRect, type ResizeEdge } from "../../pages/previewResize";
import { readStoredCodeWindow, writeStoredCodeWindow } from "../../pages/codeWindowMemory";

const WORKBENCH_MIN_WIDTH = 840;
const DOCK_INSET = 84;

function lockSelectionUntilRelease() {
  const root = document.documentElement;
  const unlock = () => root.classList.remove("lq-no-select");
  root.classList.add("lq-no-select");
  window.addEventListener("pointerup", unlock, { once: true });
  window.addEventListener("pointercancel", unlock, { once: true });
  window.addEventListener("blur", unlock, { once: true });
}

export function useFloatingWindow() {
  const [rect, setRect] = useState<PreviewRect | null>(readStoredCodeWindow);
  const dragStart = useRef<{ pointerX: number; pointerY: number; rect: PreviewRect } | null>(null);
  const resizeStart = useRef<{ edge: ResizeEdge; pointerX: number; pointerY: number; rect: PreviewRect } | null>(null);

  useEffect(() => {
    if (rect) writeStoredCodeWindow(rect);
  }, [rect]);

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    lockSelectionUntilRelease();
    dragStart.current = { pointerX: event.clientX, pointerY: event.clientY, rect: event.currentTarget.getBoundingClientRect() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const { width, height, left, top } = start.rect;
    setRect({
      left: Math.min(Math.max(left + event.clientX - start.pointerX, 8), window.innerWidth - width - 8),
      top: Math.min(Math.max(top + event.clientY - start.pointerY, 8), window.innerHeight - height - DOCK_INSET),
      width,
      height,
    });
  };
  const onResizeStart = (edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>) => {
    const frame = event.currentTarget.closest(".wb-win")?.getBoundingClientRect();
    if (!frame) return;
    lockSelectionUntilRelease();
    resizeStart.current = { edge, pointerX: event.clientX, pointerY: event.clientY, rect: frame };
  };
  const onResizeMove = (_edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setRect(resizeRect(start.rect, start.edge, event.clientX - start.pointerX, event.clientY - start.pointerY, {
      width: window.innerWidth,
      height: window.innerHeight - DOCK_INSET,
    }, WORKBENCH_MIN_WIDTH));
  };

  const storedWidth = Math.max(WORKBENCH_MIN_WIDTH, rect?.width ?? 0);
  const style: CSSProperties = {
    position: "absolute",
    zIndex: 61,
    left: rect ? `clamp(8px, ${rect.left}px, calc(100% - ${storedWidth}px - 8px))` : 32,
    top: rect ? `clamp(8px, ${rect.top}px, calc(100% - ${rect.height}px - ${DOCK_INSET}px))` : 32,
    width: rect ? `min(${storedWidth}px, calc(100% - 16px))` : "calc(100% - 64px)",
    height: rect ? `min(${rect.height}px, calc(100% - ${DOCK_INSET + 8}px))` : `calc(100% - ${DOCK_INSET + 32}px)`,
  };
  return {
    style,
    onDragStart,
    onDragMove,
    onDragEnd: () => { dragStart.current = null; },
    onResizeStart,
    onResizeMove,
    onResizeEnd: () => { resizeStart.current = null; },
  };
}
