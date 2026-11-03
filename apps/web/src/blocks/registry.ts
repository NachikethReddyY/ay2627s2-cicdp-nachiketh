import { Suspense, lazy, createElement, type ComponentType } from "react";
import type { Block } from "@learnquest/ui-catalog";

/** What every block's View.tsx receives. The default export of `./<type>/View.tsx` is the renderer. */
export type GameCompletionContext = { lessonId: string; partIdx: number };
export type BlockViewProps<P = any> = { block: Block<P>; gameCompletion?: GameCompletionContext };

// scene3d pulls in three and react-three-fiber, so it is a lazy chunk; everything else stays in the main bundle.
const mods = import.meta.glob<{ default: ComponentType<BlockViewProps> }>(["./*/View.tsx", "!./scene3d/View.tsx"], { eager: true });
const Scene3d = lazy(() => import("./scene3d/View.tsx"));
// A failed chunk import rejects into the nearest error boundary (BlockFrame), which shows the block's describe() text.
const Scene3dLoader: ComponentType<BlockViewProps> = (props) =>
  createElement(Suspense, { fallback: createElement("p", { className: "rounded-2xl border-2 border-ink bg-white p-3 text-sm font-bold" }, "Loading 3D scene...") }, createElement(Scene3d, props));

// Keyed by block type, taken from the folder name.
export const RENDERERS: Record<string, ComponentType<BlockViewProps>> = Object.fromEntries(
  [...Object.entries(mods).map(([path, m]) => [path.split("/")[1]!, m.default] as const), ["scene3d", Scene3dLoader] as const],
);
