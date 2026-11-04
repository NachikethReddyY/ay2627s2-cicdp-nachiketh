import { z } from "zod";
import type { Issue } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";
import type { GameKind } from "./shell.ts";

export const MAX_DRAG_ITEMS = 8;
export const MAX_SORT_CARDS = 10;
export const MAX_BUCKETS = 4;

const dupeIssues = (xs: string[], path: (i: number) => string, what: string): Issue[] =>
  xs.flatMap((x, i) => (xs.indexOf(x) !== i ? [{ path: path(i), message: `${what} "${x}" appears twice` }] : []));

export type OrderProps = { kind: "order"; items: string[] };
export type MatchProps = { kind: "match"; pairs: { left: string; right: string }[] };
export type SortProps = { kind: "sort"; buckets: string[]; cards: { text: string; bucket: number }[] };

const orderSchema = z.strictObject({
  kind: z.literal("order"),
  items: z.array(text(60)).min(2).max(MAX_DRAG_ITEMS),
});

/** items is the right order, top to bottom. The learner gets them shuffled. */
export const orderKind: GameKind<OrderProps> = {
  schema: orderSchema,
  check: (p) => dupeIssues(p.items, (i) => `items.${i}`, "item"),
  describe: (p) => `Put ${p.items.length} items in the right order.`,
};

const matchSchema = z.strictObject({
  kind: z.literal("match"),
  pairs: z.array(z.strictObject({ left: text(60), right: text(60) })).min(2).max(MAX_DRAG_ITEMS),
});

/** Each left item has one right partner. The learner drags each right item onto its left partner. */
export const matchKind: GameKind<MatchProps> = {
  schema: matchSchema,
  check: (p) => [
    ...dupeIssues(p.pairs.map((x) => x.left), (i) => `pairs.${i}.left`, "left item"),
    ...dupeIssues(p.pairs.map((x) => x.right), (i) => `pairs.${i}.right`, "right item"),
  ],
  describe: (p) => `Match ${p.pairs.length} pairs.`,
};

const sortSchema = z.strictObject({
  kind: z.literal("sort"),
  buckets: z.array(text(40)).min(2).max(MAX_BUCKETS),
  cards: z.array(z.strictObject({ text: text(60), bucket: z.int().min(0) })).min(2).max(MAX_SORT_CARDS),
});

/** Each card belongs in the bucket named by its index. Every bucket needs at least one card. */
export const sortKind: GameKind<SortProps> = {
  schema: sortSchema,
  check: (p) => {
    const issues: Issue[] = dupeIssues(p.cards.map((c) => c.text), (i) => `cards.${i}.text`, "card");
    p.cards.forEach((c, i) => {
      if (c.bucket >= p.buckets.length) issues.push({ path: `cards.${i}.bucket`, message: `bucket ${c.bucket} does not exist` });
    });
    p.buckets.forEach((b, i) => {
      if (!p.cards.some((c) => c.bucket === i)) issues.push({ path: `buckets.${i}`, message: `bucket "${b}" has no card` });
    });
    return issues;
  },
  describe: (p) => `Sort ${p.cards.length} cards into ${p.buckets.length} groups: ${p.buckets.join(", ")}.`,
};
