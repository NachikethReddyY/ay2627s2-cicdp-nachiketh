export type PaletteMode = "file" | "cmd" | "doc";

export type PaletteItem = { id: string; title: string; sub?: string; hint?: string; badge?: "ts" | "js" | "py" | "md" };

export function parseQuery(q: string): { mode: PaletteMode; term: string } {
  const s = q.trimStart();
  const mode: PaletteMode = s.startsWith(">") ? "cmd" : s.startsWith("?") ? "doc" : "file";
  const rest = mode === "file" ? s : s.slice(1);
  return { mode, term: rest.trim().toLowerCase() };
}

export function filterItems(items: PaletteItem[], term: string): PaletteItem[] {
  const t = term.trim().toLowerCase();
  if (!t) return items;
  return items.filter((i) => `${i.title} ${i.sub ?? ""}`.toLowerCase().includes(t));
}

export function paletteKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): PaletteMode | null {
  if (e.key.toLowerCase() !== "p" || !(e.metaKey || e.ctrlKey)) return null;
  return e.shiftKey ? "cmd" : "file";
}
