import type { CSSProperties, ReactNode } from "react";
import { Bug, Folder, GitBranch, Search, TriangleAlert, type LucideIcon } from "lucide-react";

// Planned parts of the workbench, drawn from the design (Main.dc.html) so the test page looks like
// it. Most planned tools are still inert; AI help is a working structured guide.
// The workbench shows them only with `showPlanned`; the practice view leaves them out.
// This file holds the small shared pieces. The sample-text views live in PlannedParts.tsx, which the
// workbench loads lazily so that text stays out of the main chunk.

export const SOON = "Coming soon";

export type NavView = "files" | "search" | "git" | "debug" | "problems" | "ai";

export const NAV_TABS: { id: Exclude<NavView, "ai">; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Source control", icon: GitBranch },
  { id: "debug", label: "Run and debug", icon: Bug },
  { id: "problems", label: "Problems", icon: TriangleAlert },
];

/** A button that is present but does nothing yet. */
export function Soon({ label, className = "wb-tb", style, children }: { label: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <button type="button" className={`${className} wb-soon`} style={style} aria-label={label} aria-disabled="true" title={SOON}>
      {children}
    </button>
  );
}
