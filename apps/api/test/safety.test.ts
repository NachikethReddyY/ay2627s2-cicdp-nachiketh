import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://learnquest:learnquest@localhost:5432/learnquest_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";
process.env.NODE_ENV ??= "test";
process.env.MODERATION_API_KEY = "test-key";
const { CATEGORIES, isSafe } = await import("../src/safety/moderation.ts");
type ModerationClient = import("../src/safety/moderation.ts").ModerationClient;

const clean: ModerationClient = async () => ({ flagged: false, scores: Object.fromEntries(CATEGORIES.map((c) => [c, 0.1])) });

test("exact coding allow-list topics pass", async () => {
  assert.equal(await isSafe("Python", async () => { throw new Error("should not call"); }), true);
});

test("flagged categories and high confidence scores block", async () => {
  for (const category of CATEGORIES) {
    assert.equal(await isSafe("learner supplied text", async () => ({ flagged: false, scores: { [category]: 0.9 } })), false);
  }
  assert.equal(await isSafe("learner supplied text", async () => ({ flagged: true, scores: {} })), false);
});

test("low confidence passes and provider failures fail closed", async () => {
  assert.equal(await isSafe("learner supplied text", clean), true);
  assert.equal(await isSafe("learner supplied text", async () => { throw new Error("offline"); }), false);
});

test("a stalled moderation provider is aborted within the timeout and the failure policy applies", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
  try {
    const started = Date.now();
    assert.equal(await isSafe("learner supplied text"), false, "fails closed by default");
    assert.ok(Date.now() - started < 7000, "aborted near the 5s timeout");
    assert.equal(await isSafe("learner supplied text", undefined, { failOpen: true }), true, "fails open when asked");
  } finally {
    globalThis.fetch = realFetch;
  }
});
