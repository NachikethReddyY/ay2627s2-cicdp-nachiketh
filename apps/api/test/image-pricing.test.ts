import "./helpers.ts";
import { deepEqual, equal } from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { setImmediate as drainPromises } from "node:timers/promises";
import { imageCallSpend, warmImagePrices } from "../src/media/image-pricing.ts";

const tokenRouter = "https://api.tokenrouter.com/v1";
const openRouter = "https://openrouter.ai/api/v1";

test("recognized OpenRouter image chat cost uses returned USD and preserves zero", () => {
  const usage = { prompt_tokens: 12, completion_tokens: 153, cost: 0 };
  deepEqual(imageCallSpend(openRouter, "p/m", "chat", usage, 1), {
    promptTokens: 12, completionTokens: 153, cost: 0,
  });
  equal((imageCallSpend(openRouter, "p/m", "chat", { ...usage, cost: 0.00123 }, 1)).cost, 0.00123);
  equal((imageCallSpend(openRouter, "p/m", "chat", { ...usage, cost: -1 }, 1)).cost, null);
  equal((imageCallSpend(tokenRouter, "p/m", "chat", usage, 1)).cost, null);
  equal((imageCallSpend(openRouter, "p/m", "images", usage, 1)).cost, null);
});

test("TokenRouter uses the exact fixed-image unit and keeps fresh prices on outage", async (t) => {
  const one = "bytedance-seed/seedream-5.0-lite";
  const two = "bytedance-seed/seedream-4.5";
  const unknown = "google/gemini-3.1-flash-lite-image";
  const row = (model_name: string, model_price: number) => ({
    model_name, model_price, quota_type: 1, tags: "Image",
    supported_endpoint_types: ["image-generation"], enable_groups: ["default"],
  });
  let now = 100;
  t.mock.method(performance, "now", () => now);
  let outage = false;
  const fetchCatalog = t.mock.method(globalThis, "fetch", (url: string) => {
    equal(url, "https://api.tokenrouter.com/api/pricing");
    return outage ? new Response("unavailable", { status: 503 }) : Response.json({
      success: true,
      group_ratio: { default: 1 },
      data: [
        row(one, 0.035), row(two, 0.04), { ...row(unknown, 0), quota_type: 0 },
        row("size-dependent", 0.09),
      ],
      video_generation_pricing: {
        [one]: { "Model price:image:": 0.035 },
        [two]: { "Model price:image:": 0.04 },
        "size-dependent": { "Output:image:Pixels <= 236W": 0.045, "Output:image:Pixels > 236W": 0.09 },
      },
    });
  });
  const estimate = (model: string, count = 2) =>
    imageCallSpend(tokenRouter, model, "images", undefined, count).cost;
  const refresh = async () => {
    warmImagePrices(tokenRouter, "images");
    await drainPromises();
  };
  equal(estimate(one), null);
  await refresh();

  equal(estimate(one), 0.07);
  equal(estimate(two), 0.08);
  equal(estimate(unknown), null);
  equal(estimate("size-dependent"), null);
  equal(estimate(one, 0), null);
  equal(fetchCatalog.mock.callCount(), 1);
  outage = true;
  now += 6 * 3_600_000;
  await refresh();
  equal(estimate(one), 0.07);
  equal(estimate(one), 0.07);
  equal(fetchCatalog.mock.callCount(), 2);
  now += 42 * 3_600_000 + 1;
  await refresh();
  equal(estimate(one), null);
  equal(fetchCatalog.mock.callCount(), 3);
});
