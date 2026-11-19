process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { TRPCError } from "@trpc/server";
import type { StudioDeps } from "../src/studio/route.ts";

const { studioRoutes } = await import("../src/studio/route.ts");
const { EngineError } = await import("../src/engine-client/client.ts");
const { TtsError } = await import("../src/studio/tts.ts");

const PLAN = {
  title: "Python data structures",
  summary: "Lists, tuples and dictionaries.",
  sections: [
    { goal: "Use a list", concepts: ["list"] },
    { goal: "Use a tuple", concepts: ["tuple"] },
    { goal: "Use a dict", concepts: ["dict", "get"] },
  ],
};
const SOURCE_URL = "https://docs.python.org/3/tutorial/datastructures.html";

function appWith(deps: StudioDeps = {}) {
  const app = Fastify();
  app.register(studioRoutes, deps);
  return app;
}

const signedIn = async () => "learner-1";
const noBudget = async () => undefined;

test("every studio route answers 401 without a session", async () => {
  const app = appWith({ resolveLearnerId: async () => null });
  for (const url of ["/studio/plan", "/studio/script", "/studio/audio", "/studio/transcribe"]) {
    const res = await app.inject({ method: "POST", url, payload: {} });
    assert.equal(res.statusCode, 401, url);
    assert.equal(res.json().error.code, "unauthorized");
  }
  await app.close();
});

test("plan rejects a source outside docs.python.org before any engine call", async () => {
  const calls: unknown[] = [];
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    callEngine: (async (...args: unknown[]) => calls.push(args)) as never,
  });
  const res = await app.inject({
    method: "POST",
    url: "/studio/plan",
    payload: { topic: "Python", sourceUrl: "https://example.com/tutorial" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "bad_source");
  assert.equal(calls.length, 0);
  await app.close();
});

test("plan sends the fetched source text to the engine and returns the plan", async () => {
  const engineCalls: Record<string, unknown>[] = [];
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    fetchSource: async (url: string) => {
      assert.equal(url, SOURCE_URL);
      return "Lists are mutable.";
    },
    callEngine: (async (path: string, body: Record<string, unknown>) => {
      assert.equal(path, "/v1/studio/plan");
      engineCalls.push(body);
      return { plan: PLAN, usage: {}, attempts: 1 };
    }) as never,
  });
  const res = await app.inject({ method: "POST", url: "/studio/plan", payload: { topic: "Python data structures", sourceUrl: SOURCE_URL } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { plan: PLAN });
  assert.deepEqual(engineCalls, [{ topic: "Python data structures", source: "Lists are mutable." }]);
  await app.close();
});

test("an engine failure becomes a 502 with the engine's message", async () => {
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    fetchSource: async () => "text",
    callEngine: (async () => {
      throw new EngineError("Engine answered 422", 422, { error: "invalid_output" });
    }) as never,
  });
  const res = await app.inject({ method: "POST", url: "/studio/plan", payload: { topic: "t", sourceUrl: SOURCE_URL } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error.code, "engine_error");
  assert.equal(res.json().error.message, "Engine answered 422: invalid_output");
  await app.close();
});

test("an exhausted AI budget is a 429 and calls nothing", async () => {
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: async () => {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI budget limit reached" });
    },
    fetchSource: async () => {
      throw new Error("must not fetch");
    },
  });
  const res = await app.inject({ method: "POST", url: "/studio/plan", payload: { topic: "t", sourceUrl: SOURCE_URL } });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, "rate_limited");
  await app.close();
});

test("script rejects a plan with too few sections", async () => {
  const app = appWith({ resolveLearnerId: signedIn, reserveAiSpend: noBudget });
  const res = await app.inject({
    method: "POST",
    url: "/studio/script",
    payload: { plan: { ...PLAN, sections: PLAN.sections.slice(0, 2) } },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "bad_request");
  await app.close();
});

test("script returns the engine's segments, predictions included", async () => {
  const script = { segments: [{ text: "Lists keep order." }, { text: "The answer is two.", predict: null }, { text: "Tuples stay fixed." }] };
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    callEngine: (async (path: string) => {
      assert.equal(path, "/v1/studio/script");
      return { script };
    }) as never,
  });
  const res = await app.inject({ method: "POST", url: "/studio/script", payload: { plan: PLAN } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { script });
  await app.close();
});

test("audio returns one playable wav data URL per segment", async () => {
  const spoken: string[] = [];
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    speak: async (text: string) => {
      spoken.push(text);
      return new Uint8Array([0x49, 0x44, 0x33]);
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/studio/audio",
    payload: { segments: [{ text: "hi" }, { text: "there" }] },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(spoken, ["hi", "there"]);
  assert.deepEqual(res.json(), {
    clips: [
      { index: 0, audio: "data:audio/wav;base64,SUQz" },
      { index: 1, audio: "data:audio/wav;base64,SUQz" },
    ],
  });
  await app.close();
});

test("audio refuses more than 12 segments before any voice call", async () => {
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    speak: async () => {
      throw new Error("must not speak");
    },
  });
  const segments = Array.from({ length: 13 }, () => ({ text: "x" }));
  const res = await app.inject({ method: "POST", url: "/studio/audio", payload: { segments } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("a voice failure is reported with the voice service's status", async () => {
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    speak: async () => {
      throw new TtsError("The voice service answered 401", 502);
    },
  });
  const res = await app.inject({ method: "POST", url: "/studio/audio", payload: { segments: [{ text: "hi" }] } });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().error.code, "voice_error");
  await app.close();
});

test("transcribe decodes a wav or mp3 clip and passes its format to speech-to-text", async () => {
  const heard: [number[], string][] = [];
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    listen: async (audio: Uint8Array, format: string) => {
      heard.push([[...audio], format]);
      return { text: "hi", words: [{ text: "hi", start: 0, end: 0.3 }] };
    },
  });
  for (const audio of ["data:audio/wav;base64,SUQz", "data:audio/mpeg;base64,SUQz"]) {
    const res = await app.inject({ method: "POST", url: "/studio/transcribe", payload: { audio } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { transcript: { text: "hi", words: [{ text: "hi", start: 0, end: 0.3 }] } });
  }
  assert.deepEqual(heard, [[[0x49, 0x44, 0x33], "wav"], [[0x49, 0x44, 0x33], "mp3"]]);
  await app.close();
});

test("transcribe refuses anything but an mp3 data URL before any voice call", async () => {
  const app = appWith({
    resolveLearnerId: signedIn,
    reserveAiSpend: noBudget,
    listen: async () => {
      throw new Error("must not listen");
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/studio/transcribe",
    payload: { audio: "https://example.com/clip.mp3" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "bad_request");
  await app.close();
});
