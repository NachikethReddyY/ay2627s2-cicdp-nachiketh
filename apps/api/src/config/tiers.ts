import { z } from "zod";
import { env } from "../env.ts";

const row = z.object({ aiPathsPerDay: z.number().int().positive(), visualsPerDay: z.number().int().positive(), imagesPerDay: z.number().int().positive() });
const schema = z.object({ free: row, pro: row, max: row });
const defaults = { free: { aiPathsPerDay: 5, visualsPerDay: 1, imagesPerDay: 1 }, pro: { aiPathsPerDay: 20, visualsPerDay: 4, imagesPerDay: 4 }, max: { aiPathsPerDay: 50, visualsPerDay: 10, imagesPerDay: 10 } };
let configured: unknown = defaults;
if (env.TIERS_JSON) {
  try { configured = { ...defaults, ...JSON.parse(env.TIERS_JSON) }; }
  catch (cause) { throw new Error("TIERS_JSON must contain valid JSON", { cause }); }
}
export const tiers = schema.parse(configured);
