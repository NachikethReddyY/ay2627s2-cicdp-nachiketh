import { z } from "zod";
import { MAX_BLOCKS, MIN_BLOCKS, id } from "./caps.ts";

export const envelopeSchema = z.strictObject({
  v: z.literal(1),
  blocks: z.array(z.unknown()).min(MIN_BLOCKS).max(MAX_BLOCKS),
});

export const blockSchema = <P extends z.ZodType>(type: string, props: P) =>
  z.strictObject({ type: z.literal(type), id: id(), props });
