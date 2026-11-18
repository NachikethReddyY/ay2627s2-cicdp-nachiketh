
export type TreeNode = {
  name: string;
  children?: TreeNode[];
  open?: boolean;
  status?: "M" | "A";
};

export type TreeRowData = {
  path: string;
  depth: number;
  node: TreeNode;
  open: boolean;
  isFolder: boolean;
  setSize: number;
  posInSet: number;
};

const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

export function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => (node.children ? { ...node, children: sortTree(node.children) } : node))
    .sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

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

export function flattenTree(nodes: TreeNode[], open: ReadonlySet<string>, depth = 0, parent = ""): TreeRowData[] {
  const rows: TreeRowData[] = [];
  for (const [i, node] of nodes.entries()) {
    const path = join(parent, node.name);
    const isFolder = node.children !== undefined;
    const isOpen = isFolder && open.has(path);
    rows.push({ path, depth, node, open: isOpen, isFolder, setSize: nodes.length, posInSet: i + 1 });
    if (isOpen && node.children) rows.push(...flattenTree(node.children, open, depth + 1, path));
  }
  return rows;
}

export function toggleFolder(open: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(path)) next.add(path);
  return next;
}

export function filePaths(nodes: TreeNode[], parent = ""): string[] {
  return nodes.flatMap((n) => {
    const p = join(parent, n.name);
    return n.children ? filePaths(n.children, p) : [p];
  });
}

export function ancestors(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
