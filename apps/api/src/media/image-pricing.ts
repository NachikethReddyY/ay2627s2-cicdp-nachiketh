import { performance } from "node:perf_hooks";
import { z } from "zod";
import { spendAmount, tokenCount } from "../admin/ai-spend.ts";

const tokenRouterBase = "https://api.tokenrouter.com/v1";
const tokenRouterCatalog = "https://api.tokenrouter.com/api/pricing";
const openRouterBase = "https://openrouter.ai/api/v1";
const hourMs = 3_600_000;

const catalogSchema = z.object({
  success: z.literal(true),
  group_ratio: z.object({ default: z.literal(1) }),
  video_generation_pricing: z.record(z.string(), z.unknown()),
  data: z.array(z.unknown()).min(1),
});

const fixedImageModel = z.object({
  model_name: z.string(),
  quota_type: z.literal(1),
  model_price: spendAmount,
  tags: z.literal("Image"),
  enable_groups: z.array(z.string()),
  supported_endpoint_types: z.array(z.string()),
});

let cached: { fetched: number; prices: ReadonlyMap<string, number> } | undefined;
let refreshAfter = 0;
let pending: Promise<void> | undefined;

async function refresh() {
  try {
    const response = await fetch(tokenRouterCatalog, { signal: AbortSignal.timeout(2_000), redirect: "error" });
    if (!response.ok) throw new Error("catalog unavailable");
    const catalog = catalogSchema.parse(await response.json());
    const prices = new Map<string, number>();
    for (const raw of catalog.data) {
      const { success, data: row } = fixedImageModel.safeParse(raw);
      if (!success || !row.enable_groups.includes("default") || !row.supported_endpoint_types.includes("image-generation")) continue;
      const units = z.record(z.string(), z.unknown()).safeParse(catalog.video_generation_pricing[row.model_name]);
      if (!units.success || Object.keys(units.data).length !== 1) continue;
      if (units.data["Model price:image:"] === row.model_price) prices.set(row.model_name, row.model_price);
    }
    cached = { fetched: performance.now(), prices };
    refreshAfter = cached.fetched + 6 * hourMs;
  } catch {
    refreshAfter = performance.now() + 5 * 60_000;
    console.warn("AI image pricing catalog refresh failed");
  }
}

export function warmImagePrices(base: string, style: "images" | "chat") {
  if (base === tokenRouterBase && style === "images" && performance.now() >= refreshAfter) {
    pending ??= refresh().finally(() => { pending = undefined; });
  }
}

function tokenRouterImageRate(model: string) {
  return cached && performance.now() - cached.fetched <= 48 * hourMs ? cached.prices.get(model) : undefined;
}

const usageSchema = z.object({
  cost: spendAmount.optional().catch(undefined),
  prompt_tokens: tokenCount.catch(0),
  completion_tokens: tokenCount.catch(0),
});

export function imageCallSpend(
  base: string,
  model: string,
  style: "images" | "chat",
  rawUsage: unknown,
  imageCount: number,
) {
  const usage = usageSchema.safeParse(rawUsage).data;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  let cost: number | null = null;
  if (base === openRouterBase && style === "chat") cost = usage?.cost ?? null;
  if (base === tokenRouterBase && style === "images" && imageCount > 0) {
    const rate = tokenRouterImageRate(model);
    if (rate !== undefined) cost = spendAmount.safeParse(rate * imageCount).data ?? null;
  }
  return { promptTokens, completionTokens, cost };
}
