import { z } from "zod";
import { MAX_BLOCKS, MIN_BLOCKS, id } from "./caps.ts";

// Blocks stay `unknown` here: each one is parsed by its own module so one bad block does not sink the spec.
export const envelopeSchema = z.strictObject({
  v: z.literal(1),
  blocks: z.array(z.unknown()).min(MIN_BLOCKS).max(MAX_BLOCKS),
});

// The full shape of one block of a module whose props schema is `props`.
export const blockSchema = <P extends z.ZodType>(type: string, props: P) =>
  z.strictObject({ type: z.literal(type), id: id(), props });
