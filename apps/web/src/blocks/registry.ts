import { Suspense, lazy, createElement, type ComponentType } from "react";
import type { Block } from "@learnquest/ui-catalog";

export type GameCompletionContext = { lessonId: string; versionId: string; partIdx: number; onComplete?: () => void; onStale?: () => void };
export type BlockViewProps<P = any> = { block: Block<P>; gameCompletion?: GameCompletionContext };

const mods = import.meta.glob<{ default: ComponentType<BlockViewProps> }>(["./*/View.tsx", "!./scene3d/View.tsx"], { eager: true });
const Scene3d = lazy(() => import("./scene3d/View.tsx"));
const Scene3dLoader: ComponentType<BlockViewProps> = (props) =>
  createElement(Suspense, { fallback: createElement("p", { className: "rounded-2xl border border-[var(--line)] bg-[var(--code)] p-3 text-sm font-bold" }, "Loading 3D scene...") }, createElement(Scene3d, props));

export const RENDERERS: Record<string, ComponentType<BlockViewProps>> = Object.fromEntries(
  [...Object.entries(mods).map(([path, m]) => [path.split("/")[1], m.default] as const), ["scene3d", Scene3dLoader] as const],
);
