import { performance } from "node:perf_hooks";
import { z } from "zod";
import { recordMediaCallSpend, spendAmount } from "../admin/ai-spend.ts";
import { env } from "../env.ts";

const catalogUrl = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const kokoro = "hexgrad/kokoro-82m";
const deepInfraEndpoint = "deepinfra/us";
const kokoroEndpoints = `https://openrouter.ai/api/v1/models/${kokoro}/endpoints`;
const hourMs = 3_600_000;
const catalogEntry = z.looseObject({
  litellm_provider: z.literal("together_ai"),
  mode: z.literal("audio_speech"),
  input_cost_per_character: spendAmount,
});
const catalogSchema = z.object({ "together_ai/hexgrad/Kokoro-82M": catalogEntry.optional().catch(undefined) });
const endpointCatalog = z.object({ data: z.object({
  id: z.literal(kokoro),
  endpoints: z.array(z.object({ tag: z.string(), pricing: z.unknown() })),
}) });
const perCharacter = z.strictObject({
  prompt: z.string().regex(/^\d+(?:\.\d+)?$/).transform(Number).pipe(spendAmount),
  completion: z.literal("0"),
  discount: z.literal(0).optional(),
});
const generationSchema = z.object({
  data: z.object({
    model: z.string().optional().catch(undefined),
    provider_name: z.string().optional().catch(undefined),
    total_cost: spendAmount.optional().catch(undefined),
  }),
});

function liveCharacterRate(url: string, parseRate: (body: unknown) => number | undefined) {
  let cached: { usdPerCharacter: number | undefined; fetched: number } | undefined;
  let refreshAfter = 0;
  let pending: Promise<void> | undefined;

  async function refresh() {
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(2_000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Narration pricing catalog unavailable");
      }
      cached = { usdPerCharacter: parseRate(await response.json()), fetched: performance.now() };
      refreshAfter = cached.fetched + 6 * hourMs;
    } catch {
      refreshAfter = performance.now() + 5 * 60_000;
      console.warn("Narration pricing catalog refresh failed");
    }
  }

  return async () => {
    if (performance.now() >= refreshAfter) {
      pending ??= refresh().finally(() => { pending = undefined; });
      await pending;
    }
    if (cached && performance.now() - cached.fetched <= 48 * hourMs) return cached.usdPerCharacter;
  };
}

const kokoroTogetherRate = liveCharacterRate(catalogUrl, (body) => {
  const entry = catalogSchema.parse(body)["together_ai/hexgrad/Kokoro-82M"];
  if (entry && !Object.entries(entry).some(([key, value]) =>
    key.includes("_cost_per_") && key !== "input_cost_per_character" && value !== 0,
  )) return entry.input_cost_per_character;
});

const kokoroDeepInfraRate = liveCharacterRate(kokoroEndpoints, (body) => {
  const { endpoints } = endpointCatalog.parse(body).data;
  const matching = endpoints.filter(({ tag }) => tag === deepInfraEndpoint);
  if (matching.length === 1) return perCharacter.safeParse(matching[0].pricing).data?.prompt;
});

export function narrationRouting(model: string, voice: string) {
  if (model === kokoro && voice === "af_heart") return { only: [deepInfraEndpoint] };
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
  routing?: ReturnType<typeof narrationRouting>;
};
type Pricing = { cost: number | null; source?: "openrouter" | "litellm" | "openrouter_catalog" };

function characterSpend(characters: number, rate: number | undefined, source: NonNullable<Pricing["source"]>): Pricing {
  if (rate === undefined) return { cost: null };
  const cost = spendAmount.safeParse(characters * rate).data;
  return cost === undefined ? { cost: null } : { cost, source };
}

async function narrationPrice(call: NarrationCall): Promise<Pricing> {
  if (!call.response?.ok) return { cost: null };
  const generationId = call.response.headers.get("x-generation-id");
  const usage = generationId ? await generationMetadata(generationId, call.apiKey) : undefined;
  if (usage?.total_cost !== undefined) return { cost: usage.total_cost, source: "openrouter" };
  if (call.model === kokoro && call.routing && (!usage?.model || usage.model === kokoro)
    && (!usage?.provider_name || usage.provider_name === "DeepInfra")) {
    return characterSpend(call.characters, await kokoroDeepInfraRate(), "openrouter_catalog");
  }
  if (call.model === kokoro && usage?.model === kokoro && usage.provider_name === "Together") {
    return characterSpend(call.characters, await kokoroTogetherRate(), "litellm");
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
          ...(call.response ? { $ai_http_status: call.response.status } : {}),
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
