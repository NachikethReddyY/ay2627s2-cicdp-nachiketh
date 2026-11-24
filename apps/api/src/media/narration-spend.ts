import { performance } from "node:perf_hooks";
import { z } from "zod";
import { recordMediaCallSpend, spendAmount } from "../admin/ai-spend.ts";
import { env } from "../env.ts";

const catalogUrl = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const kokoro = "hexgrad/kokoro-82m";
const hourMs = 3_600_000;
const catalogEntry = z.looseObject({
  litellm_provider: z.literal("together_ai"),
  mode: z.literal("audio_speech"),
  input_cost_per_character: spendAmount,
});
const catalogSchema = z.object({ "together_ai/hexgrad/Kokoro-82M": catalogEntry.optional().catch(undefined) });
const generationSchema = z.object({
  data: z.object({
    model: z.string().optional().catch(undefined),
    provider_name: z.string().optional().catch(undefined),
    total_cost: spendAmount.optional().catch(undefined),
  }),
});

let rate: { usdPerCharacter: number | undefined; fetched: number } | undefined;
let refreshAfter = 0;
let refreshPending: Promise<void> | undefined;

async function refreshRate() {
  try {
    const response = await fetch(catalogUrl, { redirect: "error", signal: AbortSignal.timeout(2_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("LiteLLM pricing catalog unavailable");
    }
    const entry = catalogSchema.parse(await response.json())["together_ai/hexgrad/Kokoro-82M"];
    const usdPerCharacter = entry && !Object.entries(entry).some(([key, value]) =>
      key.includes("_cost_per_") && key !== "input_cost_per_character" && value !== 0,
    ) ? entry.input_cost_per_character : undefined;
    rate = { usdPerCharacter, fetched: performance.now() };
    refreshAfter = rate.fetched + 6 * hourMs;
  } catch {
    refreshAfter = performance.now() + 5 * 60_000;
    console.warn("LiteLLM narration pricing catalog refresh failed");
  }
}

async function kokoroTogetherRate() {
  if (performance.now() >= refreshAfter) {
    refreshPending ??= refreshRate().finally(() => { refreshPending = undefined; });
    await refreshPending;
  }
  if (rate && performance.now() - rate.fetched <= 48 * hourMs) return rate.usdPerCharacter;
}

async function generationMetadata(id: string, apiKey: string) {
  const url = new URL("https://openrouter.ai/api/v1/generation");
  url.searchParams.set("id", id);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return;
    }
    return generationSchema.safeParse(await response.json()).data?.data;
  } catch {
    return;
  }
}

type NarrationCall = {
  id: string;
  apiKey: string;
  model: string;
  characters: number;
  latency: number;
  failed: boolean;
  response: Response | undefined;
};
type Pricing = { cost: number | null; source?: "openrouter" | "litellm" };

async function narrationPrice(call: NarrationCall): Promise<Pricing> {
  const generationId = call.response?.headers.get("x-generation-id");
  const usage = generationId && call.response?.ok ? await generationMetadata(generationId, call.apiKey) : undefined;
  if (usage?.total_cost !== undefined) return { cost: usage.total_cost, source: "openrouter" };
  if (call.model === kokoro && usage?.model === kokoro && usage.provider_name === "Together") {
    const rate = await kokoroTogetherRate();
    const cost = spendAmount.safeParse(rate === undefined ? null : call.characters * rate).data;
    if (cost !== undefined) return { cost, source: "litellm" };
  }
  return { cost: null };
}

export async function recordNarrationCall(call: NarrationCall) {
  const { cost, source } = await narrationPrice(call);
  if (call.response?.ok) await recordMediaCallSpend(0, 0, cost);

  const { POSTHOG_PROJECT_TOKEN: token, POSTHOG_HOST: host } = env;
  if (!token || !host) return;
  try {
    const response = await fetch(new URL("/capture/", host), {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      body: JSON.stringify({
        api_key: token,
        event: "$ai_generation",
        properties: {
          distinct_id: "learnslop-api",
          $process_person_profile: false,
          $geoip_disable: true,
          $ai_trace_id: call.id,
          $ai_span_id: call.id,
          $ai_provider: "openrouter",
          $ai_model: call.model,
          $ai_latency: call.latency,
          $ai_is_error: call.failed,
          modality: "audio",
          pricing_status: cost === null ? "unpriced" : "priced",
          ...(cost === null ? {} : { $ai_total_cost_usd: cost, pricing_source: source }),
        },
      }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Narration analytics unavailable");
  } catch {
    console.warn("Could not capture narration telemetry");
  }
}
