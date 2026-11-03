import type { MatchProps, OrderProps, SortProps } from "@learnquest/ui-catalog";

export type DragKind = OrderProps | MatchProps | SortProps;
export type Item = { id: string; label: string };
export type Zone = { id: string; label: string };
/** Where each item sits: a zone id, or null while it waits in the pool. */
export type Placed = Record<string, string | null>;
export type Setup = { items: Item[]; zones: Zone[]; start: Placed; capacity: number; isRight: (item: string, zone: string) => boolean; title: string };

export const rotate = <T,>(xs: T[]) => (xs.length > 1 ? [...xs.slice(1), xs[0]!] : xs);

/** Builds the items, zones and answer key for one drag kind. Starts are never already solved. */
export function setupFor(kind: DragKind): Setup {
  if (kind.kind === "order") {
    const n = kind.items.length;
    const right = (item: string, zone: string) => zone === `z${item.slice(1)}`;
    // Items start rotated by one place, so the list is never already in order.
    const shown = rotate(kind.items.map((t, i) => ({ id: `i${i}`, label: t })));
    const start: Placed = {};
    shown.forEach((it, pos) => (start[it.id] = `z${pos}`));
    return { items: shown, zones: Array.from({ length: n }, (_, i) => ({ id: `z${i}`, label: `Position ${i + 1}` })), start, capacity: 1, isRight: right, title: "order" };
  }
  if (kind.kind === "match") {
    const items = rotate(kind.pairs.map((x, j) => ({ id: `r${j}`, label: x.right })));
    const start: Placed = Object.fromEntries(items.map((it) => [it.id, null]));
    return {
      items,
      zones: kind.pairs.map((x, j) => ({ id: `l${j}`, label: x.left })),
      start,
      capacity: 1,
      isRight: (item, zone) => item.slice(1) === zone.slice(1),
      title: "match",
    };
  }
  const items = kind.cards.map((c, i) => ({ id: `c${i}`, label: c.text }));
  return {
    items,
    zones: kind.buckets.map((b, k) => ({ id: `b${k}`, label: b })),
    start: Object.fromEntries(items.map((it) => [it.id, null])),
    capacity: Infinity,
    isRight: (item, zone) => kind.cards[Number(item.slice(1))]!.bucket === Number(zone.slice(1)),
    title: "sort",
  };
}

