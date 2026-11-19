process.env.NODE_ENV = "production";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";

const { transcribe } = await import("../src/studio/transcribe.ts");
const { TtsError } = await import("../src/studio/tts.ts");

const CFG = { apiKey: "test-key", model: "openai/whisper-large-v3" };
const AUDIO = new Uint8Array([0x49, 0x44, 0x33]);

function fakeFetch(body: unknown, init: { status?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return new Response(JSON.stringify(body), { status: init.status ?? 200 });
  }) as typeof fetch;
  return { calls, impl };
}

const SAMPLE = {
  text: " Lists keep order.",
  duration: 1.4,
  language: "english",
  segments: [{ id: 0, start: 0, end: 1.3, text: " Lists keep order." }],
  words: [
    { word: " Lists", start: 0.1, end: 0.4 },
    { word: "keep", start: 0.45, end: 0.7, type: "word" },
    { word: "(laugh)", start: 0.7, end: 0.9, type: "audio_event" },
    { word: "order.", start: 0.9, end: 1.3 },
  ],
  usage: { seconds: 1.4, cost: 0.0001 },
};

test("transcribe posts the clip as base64 JSON in its format, asking for word timestamps", async () => {
  const { calls, impl } = fakeFetch(SAMPLE);
  await transcribe(AUDIO, "wav", CFG, impl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/audio/transcriptions");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { "content-type": "application/json", authorization: "Bearer test-key" });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    model: "openai/whisper-large-v3",
    input_audio: { data: "SUQz", format: "wav" },
    language: "en",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });
});

test("transcribe keeps the spoken words in order, trimmed, without audio events", async () => {
  const { impl } = fakeFetch(SAMPLE);
  const transcript = await transcribe(AUDIO, "wav", CFG, impl);
  assert.equal(transcript.text, "Lists keep order.");
  assert.deepEqual(transcript.words, [
    { text: "Lists", start: 0.1, end: 0.4 },
    { text: "keep", start: 0.45, end: 0.7 },
    { text: "order.", start: 0.9, end: 1.3 },
  ]);
});

test("a non-success answer from the speech service is a 502 voice error", async () => {
  const { impl } = fakeFetch({ detail: "quota" }, { status: 401 });
  await assert.rejects(transcribe(AUDIO, "wav", CFG, impl), (error: unknown) => {
    assert.ok(error instanceof TtsError);
    assert.equal(error.status, 502);
    assert.equal(error.message, "The speech-to-text service answered 401");
    return true;
  });
});

test("an answer without a words list is a 502 voice error", async () => {
  const { impl } = fakeFetch({ text: "no timings" });
  await assert.rejects(transcribe(AUDIO, "wav", CFG, impl), (error: unknown) => {
    assert.ok(error instanceof TtsError);
    assert.equal(error.message, "The speech-to-text service sent no word timings");
    return true;
  });
});

test("a network failure is a 502 voice error", async () => {
  const impl = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(transcribe(AUDIO, "wav", CFG, impl), (error: unknown) => {
    assert.ok(error instanceof TtsError);
    assert.equal(error.status, 502);
    return true;
  });
});
