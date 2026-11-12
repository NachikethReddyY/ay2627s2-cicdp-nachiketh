import type { PointerEvent as ReactPointerEvent } from "react";
import { type ResizeEdge } from "./previewResize.ts";
import "./previewResize.css";

const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

type Props = {
  onResizeStart(edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>): void;
  onResizeMove(edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>): void;
  onResizeEnd(edge: ResizeEdge, event: ReactPointerEvent<HTMLElement>): void;
};

/** Eight drag zones inside the preview window. Render them as children of `.wb-preview-float`, which must be position: fixed. */
export function PreviewResizeHandles({ onResizeStart, onResizeMove, onResizeEnd }: Props) {
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          className={`wb-preview-grip wb-preview-grip-${edge}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            onResizeStart(edge, event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) onResizeMove(edge, event);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            onResizeEnd(edge, event);
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            onResizeEnd(edge, event);
          }}
        />
      ))}
    </>
  );
}
