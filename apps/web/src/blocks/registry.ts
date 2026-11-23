import { Suspense, lazy, createElement, type ComponentType } from "react";
import type { Block } from "@learnquest/ui-catalog";

export type GameCompletionContext = { lessonId: string; versionId: string; partIdx: number; onComplete?: (lessonJustCompleted: boolean) => void; onStale?: () => void };
export type BlockViewProps<P = any> = { block: Block<P>; gameCompletion?: GameCompletionContext };

const modules = import.meta.glob<{ default: ComponentType<BlockViewProps> }>("./*/View.tsx");

export const RENDERERS: Record<string, ComponentType<BlockViewProps>> = Object.fromEntries(
  Object.entries(modules).map(([path, load]) => {
    const View = lazy(load);
    const RenderBlock: ComponentType<BlockViewProps> = (props) =>
      createElement(Suspense, { fallback: createElement("p", { role: "status" }, "Loading lesson content…") }, createElement(View, props));
    return [path.split("/")[1], RenderBlock];
  }),
);
