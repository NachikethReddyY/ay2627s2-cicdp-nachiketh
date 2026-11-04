import { z } from "zod";
import { alt } from "../../core/caps.ts";
import type { BlockModule } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";

type Props =
  | { source: "asset"; assetId: string; alt: string; caption?: string }
  | { source: "generate"; prompt: string; alt: string; caption?: string }
  | { source: "generated"; url: string; alt: string; caption?: string }
  | { source: "generated-pending"; alt: string; caption?: string };

export const imageBlock: BlockModule<Props> = {
  type: "image",
  // "generated" and "generated-pending" are written only by the API (resolveDocImages); models must not emit them.
  schema: z.discriminatedUnion("source", [
    z.strictObject({ source: z.literal("asset"), assetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), alt: alt(), caption: text(200).optional() }),
    z.strictObject({ source: z.literal("generate"), prompt: text(400), alt: alt(), caption: text(200).optional() }),
    z.strictObject({ source: z.literal("generated"), url: z.string().max(2048), alt: alt(), caption: text(200).optional() }),
    z.strictObject({ source: z.literal("generated-pending"), alt: alt(), caption: text(200).optional() }),
  ]),
  // shortcut: asset ids are checked by the caller, not the store; check at save in LQ-17
  // parseSpec passes no ids; a save-time caller passes the ids the store knows.
  check: (b, knownAssetIds?: readonly string[]) =>
    b.props.source === "asset" && knownAssetIds && !knownAssetIds.includes(b.props.assetId) ? [{ path: "props.assetId", message: `unknown asset "${b.props.assetId}"` }] : [],
  describe: (b) => `Image: ${b.props.alt}`,
  prompt: `Use \`image\` to show an existing picture from the asset library: {"source":"asset","assetId":"<id>","alt":"...","caption":"..."}.
Only use an assetId you were given. \`alt\` is required: describe what the picture shows. \`caption\` is optional.
To request a new picture instead, use {"source":"generate","prompt":"<what to draw, 1-400 chars>","alt":"...","caption":"..."}. The \`prompt\` is server-only: it is never shown to the learner, so \`alt\` must stand on its own. Keep the prompt plain and safe for children.
Never emit the sources "generated" or "generated-pending"; the server writes those.
Example: {"type":"image","id":"pic","props":{"source":"asset","assetId":"ast_pizza","alt":"A pizza cut into 8 equal slices","caption":"8 slices"}}
Example: {"type":"image","id":"cell","props":{"source":"generate","prompt":"A friendly labelled diagram of a plant cell, flat colours","alt":"A plant cell with its parts labelled"}}`,
  budget: 4,
};
