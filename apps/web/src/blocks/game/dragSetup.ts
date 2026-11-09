import type { PublicMatch, PublicOrder, PublicSort } from "@learnquest/ui-catalog";
import type { Submission } from "./api.ts";

export type DragKind = PublicOrder | PublicMatch | PublicSort;
export type Item = { id: string; label: string };
export type Zone = { id: string; label: string };
/** Where each item sits: a zone id, or null while it waits in the pool. */
export type Placed = Record<string, string | null>;
export type Setup = {
  items: Item[]; zones: Zone[]; start: Placed; capacity: number; title: string;
  /** The board as a games.check submission. Only call it once every item is placed. */
  submit: (placed: Placed) => Submission;
};

/**
 * Builds the items, zones and submission for one drag kind. The browser knows no answer key: the server sends the
 * items already shuffled (an order game never arrives solved) and grades what `submit` returns.
 */
export function setupFor(kind: DragKind): Setup {
  if (kind.kind === "order") {
    const items = kind.items.map((t, i) => ({ id: `i${i}`, label: t }));
    const zones = items.map((_, i) => ({ id: `z${i}`, label: `Position ${i + 1}` }));
    const start: Placed = {};
    items.forEach((it, pos) => (start[it.id] = `z${pos}`));
    const submit = (placed: Placed): Submission => ({
      kind: "order",
      order: zones.map((z) => items.find((it) => placed[it.id] === z.id)?.label ?? ""),
    });
    return { items, zones, start, capacity: 1, title: "order", submit };
  }
  if (kind.kind === "match") {
    const items = kind.rights.map((t, j) => ({ id: `r${j}`, label: t }));
    const zones = kind.lefts.map((t, j) => ({ id: `l${j}`, label: t }));
    return {
      items,
      zones,
      start: Object.fromEntries(items.map((it) => [it.id, null])),
      capacity: 1,
      title: "match",
      submit: (placed) => ({
        kind: "match",
        pairs: zones.map((z) => ({ left: z.label, right: items.find((it) => placed[it.id] === z.id)?.label ?? "" })),
      }),
    };
  }
  const items = kind.cards.map((c, i) => ({ id: `c${i}`, label: c }));
  return {
    items,
    zones: kind.buckets.map((b, k) => ({ id: `b${k}`, label: b })),
    start: Object.fromEntries(items.map((it) => [it.id, null])),
    capacity: Infinity,
    title: "sort",
    submit: (placed) => ({ kind: "sort", cards: items.map((it) => ({ text: it.label, bucket: Number(placed[it.id]!.slice(1)) })) }),
  };
}
