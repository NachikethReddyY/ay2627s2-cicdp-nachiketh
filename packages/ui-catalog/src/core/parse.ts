import type { z } from "zod";
import { MAX_SPEC_BYTES } from "./caps.ts";
import { blockSchema, envelopeSchema } from "./envelope.ts";
import { RESERVED } from "./reserved.ts";
import { chartBlock } from "../blocks/chart/index.ts";
import { diagramBlock } from "../blocks/diagram/index.ts";
import { imageBlock } from "../blocks/image/index.ts";
import { scene3dBlock } from "../blocks/scene3d/index.ts";
import { stageBlock } from "../blocks/stage/index.ts";
import { textBlock } from "../blocks/text/index.ts";

/** `path` is dotted from the spec root; dots and backslashes inside segments are escaped. */
export type Issue = { path: string; message: string };

export type Block<P = unknown> = { type: string; id: string; props: P };
export type Spec = { v: 1; blocks: Block[] };

export type BlockModule<P = any> = {
  type: string;
  /** Strict props schema (z.strictObject) with its caps; the core wraps it as { type, id, props }. */
  schema: z.ZodType<P>;
  /** Semantic checks the schema cannot express. Paths are relative to the block, e.g. "props.items.0". */
  check: (block: Block<P>, ...ctx: any[]) => Issue[];
  /** One-line plain-text summary of the block, for logs and screen-reader fallbacks. */
  describe: (block: Block<P>) => string;
  /** Prompt fragment that teaches the model this block. */
  prompt: string;
  /** Most blocks of this type allowed in one spec. */
  budget: number;
};

// Registered block modules.
export const BLOCKS: readonly BlockModule[] = [textBlock, imageBlock, diagramBlock, chartBlock, stageBlock, scene3dBlock];

export type ParseResult = { ok: true; spec: Spec; issues: Issue[] } | { ok: false; issues: Issue[] };

const at = (path: PropertyKey[]) =>
  path.length ? path.map((part) => String(part).replace(/\\/g, "\\\\").replace(/\./g, "\\.")).join(".") : "$";

const zodIssues = (error: z.ZodError, prefix: PropertyKey[] = []): Issue[] =>
  error.issues.flatMap((i) =>
    i.code === "unrecognized_keys"
      ? i.keys.map((k) => ({ path: at([...prefix, ...i.path, k]), message: "unknown property" }))
      : [{ path: at([...prefix, ...i.path]), message: i.message }],
  );

/**
 * Envelope failures reject the whole spec. Otherwise each block is parsed on its own:
 * valid blocks are kept, bad ones are dropped and reported. `ok` is false when no block survives.
 * `enabled` is the registry to accept; a registered module left out of it is rejected as disabled.
 */
export function parseSpec(input: unknown, enabled: readonly BlockModule[] = BLOCKS): ParseResult {
  let data = input;
  try {
    const raw = typeof input === "string" ? input : JSON.stringify(input);
    if (raw === undefined) return { ok: false, issues: [{ path: "$", message: "spec is empty" }] };
    if (new TextEncoder().encode(raw).length > MAX_SPEC_BYTES)
      return { ok: false, issues: [{ path: "$", message: `spec is over ${MAX_SPEC_BYTES} bytes` }] };
    if (typeof input === "string") data = JSON.parse(input);
  } catch {
    return { ok: false, issues: [{ path: "$", message: "spec is not valid JSON" }] };
  }

  const env = envelopeSchema.safeParse(data);
  if (!env.success) return { ok: false, issues: zodIssues(env.error) };

  const issues: Issue[] = [];
  const blocks: Block[] = [];
  const counts = new Map<string, number>();
  const ids = new Set<string>();

  env.data.blocks.forEach((raw, i) => {
    const fail = (path: string, message: string) =>
      issues.push({ path: at(["blocks", i, ...(path ? path.split(".") : [])]), message });
    const type = (raw as { type?: unknown } | null)?.type;
    if (typeof type !== "string") return fail("type", "block type is missing");
    if (RESERVED.includes(type)) return fail("type", `"${type}" blocks are not available`);
    const mod = enabled.find((m) => m.type === type);
    if (!mod)
      return fail("type", BLOCKS.some((m) => m.type === type) ? `"${type}" blocks are disabled` : `unknown block type "${type}"`);

    const parsed = blockSchema(type, mod.schema).safeParse(raw);
    if (!parsed.success) return issues.push(...zodIssues(parsed.error, ["blocks", i]));
    const block = parsed.data as Block;
    const bad = mod.check(block);
    if (bad.length) return bad.forEach((b) => fail(b.path, b.message));
    if (ids.has(block.id)) return fail("id", `duplicate block id "${block.id}"`);
    const n = (counts.get(type) ?? 0) + 1;
    if (n > mod.budget) return fail("", `too many "${type}" blocks (max ${mod.budget})`);

    counts.set(type, n);
    ids.add(block.id);
    blocks.push(block);
  });

  return blocks.length ? { ok: true, spec: { v: 1, blocks }, issues } : { ok: false, issues };
}
