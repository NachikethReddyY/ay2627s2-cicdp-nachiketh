// Pure helpers for the navigator's file tree: flatten the visible rows and toggle folders.

export type TreeNode = {
  name: string;
  /** A folder holds `children` (possibly none); a file does not. */
  children?: TreeNode[];
  /** Folders: open at first. */
  open?: boolean;
  /** Source-control letter shown at the end of the row. */
  status?: "M" | "A";
};

export type TreeRowData = {
  /** Slash-joined path from the root, unique per node. */
  path: string;
  depth: number;
  node: TreeNode;
  open: boolean;
  isFolder: boolean;
};

const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

/** Paths of the folders that start open. */
export function initialOpen(nodes: TreeNode[], parent = ""): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    const p = join(parent, n.name);
    if (!n.children) continue;
    if (n.open) out.add(p);
    for (const o of initialOpen(n.children, p)) out.add(o);
  }
  return out;
}

/** The rows to draw, top to bottom: closed folders hide their children. */
export function flattenTree(nodes: TreeNode[], open: ReadonlySet<string>, depth = 0, parent = ""): TreeRowData[] {
  const rows: TreeRowData[] = [];
  for (const node of nodes) {
    const path = join(parent, node.name);
    const isFolder = node.children !== undefined;
    const isOpen = isFolder && open.has(path);
    rows.push({ path, depth, node, open: isOpen, isFolder });
    if (isOpen && node.children) rows.push(...flattenTree(node.children, open, depth + 1, path));
  }
  return rows;
}

/** A new set with `path` flipped. */
export function toggleFolder(open: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(path)) next.add(path);
  return next;
}

/** Every file path in the tree, in row order, whether or not its folders are open. */
export function filePaths(nodes: TreeNode[], parent = ""): string[] {
  return nodes.flatMap((n) => {
    const p = join(parent, n.name);
    return n.children ? filePaths(n.children, p) : [p];
  });
}
