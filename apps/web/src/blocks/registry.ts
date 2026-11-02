import type { ComponentType } from "react";
import type { Block } from "@learnquest/ui-catalog";

/** What every block's View.tsx receives. The default export of `./<type>/View.tsx` is the renderer. */
export type BlockViewProps<P = any> = { block: Block<P> };

const mods = import.meta.glob<{ default: ComponentType<BlockViewProps> }>("./*/View.tsx", { eager: true });

// Keyed by block type, taken from the folder name. Empty until block modules land.
export const RENDERERS: Record<string, ComponentType<BlockViewProps>> = Object.fromEntries(
  Object.entries(mods).map(([path, m]) => [path.split("/")[1]!, m.default]),
);
