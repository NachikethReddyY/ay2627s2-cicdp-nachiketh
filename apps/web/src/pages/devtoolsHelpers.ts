// Pure helpers for the preview developer tools panel. No DOM, so they run under node:test.
import type { DomNode, LogLevel, NetworkEntry } from "./previewDevtoolsProtocol.ts";

/** Ids from the root down to the node with `id`, inclusive. Null when the node is not in the tree. */
export function findPath(root: DomNode, id: number): number[] | null {
  const seen = new Set<DomNode>();
  const walk = (node: DomNode, depth: number): number[] | null => {
    if (node.id === id) return [node.id];
    if (depth >= 200 || seen.has(node) || !Array.isArray(node.children)) return null;
    seen.add(node);
    for (const child of node.children) {
      const rest = walk(child, depth + 1);
      if (rest) return [node.id, ...rest];
    }
    return null;
  };
  return walk(root, 0);
}

export function hasNode(root: DomNode, id: number): boolean {
  return findPath(root, id) !== null;
}

/** Ids of every node that is open by default: the first `depth` levels that have element children. */
export function defaultExpanded(root: DomNode, depth = 3): Set<number> {
  const open = new Set<number>();
  const walk = (node: DomNode, level: number): void => {
    if (level >= depth || node.children.length === 0) return;
    open.add(node.id);
    for (const child of node.children) walk(child, level + 1);
  };
  walk(root, 0);
  return open;
}

export type TreeRow = { node: DomNode; depth: number; parentId: number | null };

/** The rows a tree shows, top to bottom, given which nodes are expanded. */
export function visibleRows(root: DomNode, expanded: ReadonlySet<number>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (node: DomNode, depth: number, parentId: number | null): void => {
    rows.push({ node, depth, parentId });
    if (!expanded.has(node.id)) return;
    for (const child of node.children) walk(child, depth + 1, node.id);
  };
  walk(root, 0, null);
  return rows;
}

export function isTextNode(node: DomNode): boolean {
  return node.tag === "#text";
}

export function filterLogs<T extends { level: LogLevel }>(logs: readonly T[], levels: ReadonlySet<LogLevel> | null): T[] {
  if (!levels || levels.size === 0) return [...logs];
  return logs.filter((log) => levels.has(log.level));
}

export function formatBytes(size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size) || size < 0) return "-";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} kB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "pending";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** The path (plus query) of a URL, or the input unchanged when it does not parse. */
export function urlPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || url;
  } catch {
    return url;
  }
}

/** The last path segment of a URL, for the Name column. */
export function urlName(url: string): string {
  const path = urlPath(url).split("?")[0] ?? "";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? (path || url);
}

export function isFailedRequest(entry: NetworkEntry): boolean {
  return entry.error !== undefined || (entry.status !== undefined && entry.status >= 400);
}

/** Replace the row with the same id, or append. Returns a new array. */
export function upsertNetwork(list: readonly NetworkEntry[], entry: NetworkEntry): NetworkEntry[] {
  const at = list.findIndex((item) => item.id === entry.id);
  if (at === -1) return [...list, entry];
  const next = [...list];
  next[at] = entry;
  return next;
}

/** Rows to show: later updates win on a repeated id, and ids at or below `clearedUpTo` are hidden. */
export function visibleNetwork(entries: readonly NetworkEntry[], clearedUpTo: number): NetworkEntry[] {
  let rows: NetworkEntry[] = [];
  for (const entry of entries) {
    if (entry.id <= clearedUpTo) continue;
    rows = upsertNetwork(rows, entry);
  }
  return rows;
}

export type ParsedDeclaration = { property: string; value: string; important: boolean };

/** Parse "color: red !important;" into parts. Null when there is no property or no colon. */
export function parseDeclaration(text: string): ParsedDeclaration | null {
  const trimmed = text.trim().replace(/;+\s*$/, "");
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const property = trimmed.slice(0, colon).trim();
  let value = trimmed.slice(colon + 1).trim();
  if (!property) return null;
  let important = false;
  const match = /\s*!\s*important\s*$/i.exec(value);
  if (match) {
    important = true;
    value = value.slice(0, match.index).trim();
  }
  return { property, value, important };
}

export function filterComputed(computed: Readonly<Record<string, string>>, query: string): [string, string][] {
  const needle = query.trim().toLowerCase();
  return Object.entries(computed)
    .filter(([name, value]) => !needle || name.toLowerCase().includes(needle) || value.toLowerCase().includes(needle))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Short `<tag id class>` summary for a row's opening tag, attributes in the order given. */
export function attrEntries(node: DomNode): [string, string][] {
  return Object.entries(node.attrs);
}
