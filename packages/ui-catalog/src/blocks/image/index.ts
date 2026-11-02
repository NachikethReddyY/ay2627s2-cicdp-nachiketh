import { z } from "zod";
import { alt } from "../../core/caps.ts";
import type { BlockModule } from "../../core/parse.ts";
import { text } from "../../core/sanitize.ts";

type Props = { source: "asset"; assetId: string; alt: string; caption?: string };

export const imageBlock: BlockModule<Props> = {
  type: "image",
  schema: z.strictObject({
    source: z.literal("asset"),
    assetId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    alt: alt(),
    caption: text(200).optional(),
  }),
  // shortcut: asset ids are checked by the caller, not the store; check at save in LQ-17
  // parseSpec passes no ids; a save-time caller passes the ids the store knows.
  check: (b, knownAssetIds?: readonly string[]) =>
    knownAssetIds && !knownAssetIds.includes(b.props.assetId) ? [{ path: "props.assetId", message: `unknown asset "${b.props.assetId}"` }] : [],
  describe: (b) => `Image: ${b.props.alt}`,
  prompt: `Use \`image\` to show an existing picture from the asset library: {"source":"asset","assetId":"<id>","alt":"...","caption":"..."}.
Only use an assetId you were given. \`alt\` is required: describe what the picture shows. \`caption\` is optional.
The "generate" source is not available yet; do not use it.
Example: {"type":"image","id":"pic","props":{"source":"asset","assetId":"ast_pizza","alt":"A pizza cut into 8 equal slices","caption":"8 slices"}}`,
  budget: 4,
};
