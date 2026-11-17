import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { resizeRect, type PreviewRect, type ResizeEdge } from "../../pages/previewResize";
import { readStoredCodeWindow, writeStoredCodeWindow } from "../../pages/codeWindowMemory";

/** While a window is dragged or resized, stop text selection across the whole page until the pointer is released. */
function lockSelectionUntilRelease() {
  const root = document.documentElement;
  const unlock = () => root.classList.remove("lq-no-select");
  root.classList.add("lq-no-select");
  window.addEventListener("pointerup", unlock, { once: true });
  window.addEventListener("pointercancel", unlock, { once: true });
  window.addEventListener("blur", unlock, { once: true }); // released over another app, the pointerup never arrives
}

// The code window as /test/editor draws it: dragged by its title bar, resized from its edges, and remembered per browser.
// Until it is moved or resized it keeps the default inset on the desk, clear of the dock at the bottom (72px).
export function useFloatingWindow() {
  const [rect, setRect] = useState<PreviewRect | null>(readStoredCodeWindow);
  const frame: PreviewRect = rect ?? { left: 32, top: 32, width: window.innerWidth - 64, height: window.innerHeight - 104 };
  const dragStart = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  const resizeStart = useRef<{ edge: ResizeEdge; pointerX: number; pointerY: number; rect: PreviewRect } | null>(null);

  useEffect(() => {
    if (rect) writeStoredCodeWindow(rect);
  }, [rect]);

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    lockSelectionUntilRelease();
    dragStart.current = { pointerX: event.clientX, pointerY: event.clientY, left: frame.left, top: frame.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = dragStart.current;
    if (!start) return;
    const { width, height } = frame;
    // Keep at least 80px of the window on screen, so it can slide partly off the edge but never vanish.
    const KEEP = 80;
    setRect({
      left: Math.min(Math.max(start.left + event.clientX - start.pointerX, KEEP - width), window.innerWidth - KEEP),
      top: Math.min(Math.max(start.top + event.clientY - start.pointerY, 0), window.innerHeight - KEEP),
      width,
      height,
    });
  };
  const onResizeStart = (edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>) => {
    lockSelectionUntilRelease();
    resizeStart.current = { edge, pointerX: event.clientX, pointerY: event.clientY, rect: frame };
  };
  const onResizeMove = (_edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>) => {
    const start = resizeStart.current;
    if (!start) return;
    setRect(resizeRect(start.rect, start.edge, event.clientX - start.pointerX, event.clientY - start.pointerY, { width: window.innerWidth, height: window.innerHeight }));
  };

  const style: CSSProperties = { position: "absolute", zIndex: 61, left: frame.left, top: frame.top, width: frame.width, height: frame.height };
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
