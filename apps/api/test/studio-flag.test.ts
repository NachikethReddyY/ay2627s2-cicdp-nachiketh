import "./helpers.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { parseEnv } = await import("../src/env.ts");

const base = { DATABASE_URL: "postgres://x:x@localhost:5432/x_test", BETTER_AUTH_SECRET: "test-only-secret-not-for-production-0123456789" };

test("the studio prototype is off unless STUDIO_ENABLED=true", () => {
  const off = parseEnv(base);
  assert.ok(off.success);
  assert.equal(off.data.STUDIO_ENABLED, false);
  const on = parseEnv({ ...base, STUDIO_ENABLED: "true" });
  assert.ok(on.success);
  assert.equal(on.data.STUDIO_ENABLED, true);
});

test("the voice and speech-to-text models default to OpenRouter's Kokoro voice at 24 kHz and Whisper", () => {
  const parsed = parseEnv(base);
  assert.ok(parsed.success);
  assert.equal(parsed.data.STUDIO_TTS_MODEL, "hexgrad/kokoro-82m");
  assert.equal(parsed.data.STUDIO_TTS_VOICE, "af_heart");
  assert.equal(parsed.data.STUDIO_TTS_SAMPLE_RATE, 24_000);
  assert.equal(parsed.data.STUDIO_STT_MODEL, "openai/whisper-large-v3");
  assert.equal(parsed.data.OPENROUTER_API_KEY, undefined);
});

test("production Studio with an OpenRouter key requires an AI budget", () => {
  const studio = { ...base, NODE_ENV: "production", STUDIO_ENABLED: "true", OPENROUTER_API_KEY: "test-key" };
  assert.equal(parseEnv(studio).success, false);
  assert.equal(parseEnv({ ...studio, AI_DAILY_BUDGET_USD: "1" }).success, true);
});
