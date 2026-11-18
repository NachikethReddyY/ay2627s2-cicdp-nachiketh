import type { CSSProperties, ReactNode } from "react";
import { Bug, Folder, GitBranch, Search, TriangleAlert, type LucideIcon } from "lucide-react";

export const SOON = "Coming soon";

export type NavView = "files" | "search" | "git" | "debug" | "problems" | "ai";

export const NAV_TABS: { id: Exclude<NavView, "ai">; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "Files", icon: Folder },
  { id: "search", label: "Search", icon: Search },
  { id: "git", label: "Source control", icon: GitBranch },
  { id: "debug", label: "Run and debug", icon: Bug },
  { id: "problems", label: "Problems", icon: TriangleAlert },
];

export function Soon({ label, className = "wb-tb", style, children }: { label: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <button type="button" className={`${className} wb-soon`} style={style} aria-label={label} aria-disabled="true" title={SOON}>
      {children}
    </button>
  );
}
