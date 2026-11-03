import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://learnquest:learnquest@localhost:5432/learnquest_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";
const { env } = await import("../src/env.ts");
const { generateImage } = await import("../src/media/imagegen.ts");
const { setModerationClient } = await import("../src/safety/moderation.ts");

const input = { lessonVersionId: "v1", prompt: "A cell diagram, labelled", description: "Cell diagram", tier: "free" as const };
const noNetwork = async () => { throw new Error("network must not be called"); };
const clean = async () => ({ flagged: false, scores: Object.fromEntries(["hate", "harassment", "self-harm", "sexual", "violence", "illicit", "jailbreak"].map((c) => [c, 0.1])) });

test("no image settings returns the marked description fallback without a network call", async () => {
  Object.assign(env, { IMAGE_BASE_URL: undefined, IMAGE_API_KEY: undefined, IMAGE_MODEL: undefined });
  setModerationClient(clean);
  const r = await generateImage(input, noNetwork);
  assert.deepEqual(r, { status: "fallback", description: "Cell diagram", marked: true });
});

test("a flagged prompt is refused before any network call", async () => {
  Object.assign(env, { IMAGE_BASE_URL: "https://images.example.test", IMAGE_API_KEY: "test-key", IMAGE_MODEL: "test-model" });
  setModerationClient(async () => ({ flagged: true, scores: {} }));
  const r = await generateImage(input, noNetwork);
  assert.equal(r.status, "fallback");
});
