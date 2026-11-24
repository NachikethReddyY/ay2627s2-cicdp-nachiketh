import { out, signUp, trpc } from "./helpers.ts";
import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { aiCallSpend, lessonMedia, lessons, steps, user, worlds } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { memoryStorage, setStorage } from "../src/media/storage.ts";

const app = buildApp();
after(() => app.close());
const audio = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);

async function fixture(t: TestContext) {
  const owner = "owner@example.test";
  const a = trpc(app, await signUp(app, owner));
  const b = trpc(app, await signUp(app, "other@example.test"));
  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, owner));
  const [lesson] = await db.select().from(lessons).where(eq(lessons.slug, "lesson-1"));
  await db.update(worlds).set({ visibility: "private", origin: "ai", ownerId: account.id }).where(eq(worlds.id, lesson.worldId));
  await db.update(lessons).set({ sourceKind: "ai", status: "draft" }).where(eq(lessons.id, lesson.id));
  const [step] = await db.select().from(steps).where(eq(steps.id, "s1"));
  const text = "The reduce callback adds each price to the total.";
  await db.update(steps).set({ secret: { ...step.secret, narration: text } }).where(eq(steps.id, step.id));
  const store = memoryStorage();
  const previous = { ...env };
  env.OPENROUTER_API_KEY = "mock-openrouter-key";
  setStorage(store);
  t.after(() => {
    setStorage(null);
    Object.assign(env, previous, {
      OPENROUTER_API_KEY: previous.OPENROUTER_API_KEY,
      POSTHOG_PROJECT_TOKEN: previous.POSTHOG_PROJECT_TOKEN,
      POSTHOG_HOST: previous.POSTHOG_HOST,
    });
  });
  return { a, b, lesson, step, store, text };
}

test("a private Predict step synthesizes only after reveal and shares the cached MP3 across requests", async (t) => {
  const { a, b, lesson, step, store, text } = await fixture(t);
  const req = { id: step.id };
  let respond!: (response: Response) => void;
  let markContacted!: () => void;
  const provider = new Promise<Response>((resolve) => { respond = resolve; });
  const contacted = new Promise<void>((resolve) => { markContacted = resolve; });
  const speech = t.mock.method(globalThis, "fetch", (async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/audio/speech");
    assert.equal(options?.method, "POST");
    assert.deepEqual(options.headers, { authorization: "Bearer mock-openrouter-key", "content-type": "application/json" });
    assert.equal(options.body, JSON.stringify({ model: "hexgrad/kokoro-82m", input: text, voice: "af_heart", response_format: "mp3" }));
    assert.ok(options.signal);
    markContacted();
    return provider;
  }) satisfies typeof fetch);

  assert.equal((await a.m("steps.narration", req)).statusCode, 409);
  assert.equal((await b.m("steps.narration", req)).statusCode, 404);
  assert.equal((await a.q("steps.reveal", req)).statusCode, 409);
  assert.equal(speech.mock.callCount(), 0);
  assert.equal((await a.m("steps.attempt", { ...req, answer: { kind: "mcq", choice: 1 } })).statusCode, 200);
  const reveal = out(await a.q("steps.reveal", req));
  assert.equal(reveal.narration, text);
  assert.ok(!("url" in reveal));
  assert.equal(speech.mock.callCount(), 0, "the reveal response is independent of the speech service");

  const first = a.m("steps.narration", req);
  await contacted;
  const concurrent = a.m("steps.narration", req);
  assert.equal(out(await a.q("steps.reveal", req)).narration, text);
  assert.deepEqual(out(await a.q("lessons.get", { id: lesson.slug })).media, []);
  respond(new Response(audio, { headers: { "content-type": "audio/mpeg" } }));
  const [one, two] = await Promise.all([first, concurrent]);
  assert.equal(one.statusCode, 200);
  const key = store.objects.keys().next().value;
  assert.ok(key);
  assert.deepEqual(out(one), { url: `memory://${key}` });
  assert.deepEqual(out(two), out(one));
  assert.deepEqual(store.objects.get(key)?.body, Buffer.from(audio));
  assert.deepEqual(out(await a.m("steps.narration", req)), out(one));
  assert.deepEqual(out(await a.q("lessons.get", { id: lesson.slug })).media, [{ kind: "narration", stepId: step.id, segment: null, url: `memory://${key}` }]);
  assert.equal((await b.m("steps.narration", req)).statusCode, 404);
  assert.equal(speech.mock.callCount(), 1);
});

test("provider failure falls back and rapid retries reuse the failed reservation", async (t) => {
  const { a, step, store } = await fixture(t);
  const req = { id: step.id };
  const speech = t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  assert.equal((await a.m("steps.attempt", { ...req, answer: { kind: "mcq", choice: 1 } })).statusCode, 200);
  assert.deepEqual(out(await a.m("steps.narration", req)), { url: null });
  assert.deepEqual(out(await a.m("steps.narration", req)), { url: null });
  assert.equal(speech.mock.callCount(), 1);
  assert.equal(store.objects.size, 0);
  const [row] = await db.select().from(lessonMedia).where(eq(lessonMedia.stepId, step.id));
  assert.deepEqual([row.status, row.key], ["failed", null]);
});

const pricingCases = [
  { name: "uses LiteLLM's live Together character rate", provider: "Together", cost: 0.000123, source: "litellm" },
  { name: "prefers OpenRouter's reported zero", provider: "Together", billed: 0, cost: 0, source: "openrouter" },
  { name: "leaves a provider without a matching rate unpriced", provider: "DeepInfra", cost: null },
] as const;

for (const scenario of pricingCases) {
  test(`narration accounting ${scenario.name}`, async (t) => {
    const { a, step, text } = await fixture(t);
    const expectedCost = scenario.cost;
    env.POSTHOG_PROJECT_TOKEN = "mock-posthog-token";
    env.POSTHOG_HOST = "https://posthog.example";
    const captures: unknown[] = [];
    let catalogCalls = 0;
    const http = t.mock.method(globalThis, "fetch", (async (url, options) => {
      switch (String(url)) {
        case "https://openrouter.ai/api/v1/audio/speech":
          return new Response(audio, { headers: { "content-type": "audio/mpeg", "x-generation-id": "gen-test" } });
        case "https://openrouter.ai/api/v1/generation?id=gen-test":
          assert.deepEqual(options?.headers, { authorization: "Bearer mock-openrouter-key" });
          return Response.json({ data: {
            model: "hexgrad/kokoro-82m",
            provider_name: scenario.provider,
            ...("billed" in scenario ? { total_cost: scenario.billed } : {}),
          } });
        case "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json":
          catalogCalls += 1;
          assert.equal(options?.headers, undefined);
          return Response.json({ "together_ai/hexgrad/Kokoro-82M": {
            litellm_provider: "together_ai", mode: "audio_speech", input_cost_per_character: 0.000123 / [...text].length,
          } });
        case "https://posthog.example/capture/":
          captures.push(JSON.parse(String(options?.body)));
          return new Response(null, { status: 200 });
        default:
          throw new Error(`Unexpected URL ${String(url)}`);
      }
    }) satisfies typeof fetch);
    const matchingSpend = and(
      eq(aiCallSpend.promptTokens, 0),
      eq(aiCallSpend.completionTokens, 0),
      expectedCost === null ? isNull(aiCallSpend.estimatedUsd) : eq(aiCallSpend.estimatedUsd, expectedCost.toFixed(12)),
    );
    const countBefore = await db.$count(aiCallSpend, matchingSpend);
    assert.equal((await a.m("steps.attempt", { id: step.id, answer: { kind: "mcq", choice: 1 } })).statusCode, 200);
    assert.match(out(await a.m("steps.narration", { id: step.id })).url, /^memory:/);
    const callsBeforeReplay = http.mock.callCount();
    assert.match(out(await a.m("steps.narration", { id: step.id })).url, /^memory:/);
    assert.equal(http.mock.callCount(), callsBeforeReplay);
    assert.equal(catalogCalls, "source" in scenario && scenario.source === "litellm" ? 1 : 0);
    assert.equal(await db.$count(aiCallSpend, matchingSpend), countBefore + 1);
    const [{ properties, event }] = captures as { properties: Record<string, unknown>; event: string }[];
    assert.equal(captures.length, 1);
    assert.equal(event, "$ai_generation");
    assert.equal(properties.modality, "audio");
    assert.equal(properties.$ai_model, "hexgrad/kokoro-82m");
    assert.equal(properties.$ai_is_error, false);
    assert.equal(properties.pricing_status, scenario.cost === null ? "unpriced" : "priced");
    assert.equal(properties.pricing_source, "source" in scenario ? scenario.source : undefined);
    assert.equal(properties.$ai_total_cost_usd, expectedCost ?? undefined);
    assert.ok(!JSON.stringify(captures).includes(text));
  });
}

test("a disabled or over-budget speech service returns no URL without a provider request", async (t) => {
  const { a, step } = await fixture(t);
  const req = { id: step.id };
  const speech = t.mock.method(globalThis, "fetch", async () => new Response(audio, { headers: { "content-type": "audio/mpeg" } }));
  assert.equal((await a.m("steps.attempt", { ...req, answer: { kind: "mcq", choice: 1 } })).statusCode, 200);
  env.AI_KILL_SWITCH = true;
  assert.deepEqual(out(await a.m("steps.narration", req)), { url: null });
  env.AI_KILL_SWITCH = false;
  env.AI_DAILY_BUDGET_USD = env.STUDIO_TTS_ESTIMATE_USD / 2;
  assert.deepEqual(out(await a.m("steps.narration", req)), { url: null });
  assert.equal(speech.mock.callCount(), 0);
});
