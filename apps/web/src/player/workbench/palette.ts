export type PaletteMode = "file" | "cmd" | "doc";

export type PaletteItem = { id: string; title: string; sub?: string; hint?: string; badge?: "ts" | "js" | "py" | "md" };

/** A leading `>` is commands, a leading `?` is docs, anything else is files. `term` is trimmed and lower-cased. */
export function parseQuery(q: string): { mode: PaletteMode; term: string } {
  const s = q.trimStart();
  const mode: PaletteMode = s.startsWith(">") ? "cmd" : s.startsWith("?") ? "doc" : "file";
  const rest = mode === "file" ? s : s.slice(1);
  return { mode, term: rest.trim().toLowerCase() };
}

/** Case-insensitive substring match on title and sub. An empty term returns everything. */
export function filterItems(items: PaletteItem[], term: string): PaletteItem[] {
  const t = term.trim().toLowerCase();
  if (!t) return items;
  return items.filter((i) => `${i.title} ${i.sub ?? ""}`.toLowerCase().includes(t));
}

/** Cmd/Ctrl+P is files, Cmd/Ctrl+Shift+P is commands. */
export function paletteKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): PaletteMode | null {
  if (e.key.toLowerCase() !== "p" || !(e.metaKey || e.ctrlKey)) return null;
  return e.shiftKey ? "cmd" : "file";
}
