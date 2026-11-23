import type { DirEntry } from "../runPython";
import type { TreeNode } from "./fileTree";

export type Listing = { entries: DirEntry[]; truncated: boolean };
export type DirState = Listing | "loading" | "error";

const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

function childrenOf(state: DirState | undefined, dirs: ReadonlyMap<string, DirState>, path: string): TreeNode[] {
  if (state === undefined) return [];
  if (state === "loading") return [{ name: "Loading…" }];
  if (state === "error") return [{ name: "Could not list files" }];
  return sandboxNodes(state, dirs, path);
}

export function sandboxNodes(listing: Listing, dirs: ReadonlyMap<string, DirState>, parent = ""): TreeNode[] {
  const nodes: TreeNode[] = listing.entries.map((entry) =>
    entry.type === "dir"
      ? { name: entry.name, children: childrenOf(dirs.get(join(parent, entry.name)), dirs, join(parent, entry.name)) }
      : { name: entry.name },
  );
  if (listing.truncated) nodes.push({ name: "…more" });
  return nodes;
}
