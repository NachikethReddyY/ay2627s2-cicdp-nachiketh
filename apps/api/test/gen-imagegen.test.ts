import "./helpers.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { env } from "../src/env.ts";
import { db } from "../src/db/client.ts";
import { seed } from "../src/db/seed.ts";
import { learners, lessons, spendLedger, user } from "../src/db/schema.ts";
import { generateImage, resolveDocImages } from "../src/media/imagegen.ts";
import { memoryStorage, setStorage } from "../src/media/storage.ts";
import { setModerationClient } from "../src/safety/moderation.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const scores = { hate: 0, harassment: 0, "self-harm": 0, sexual: 0, violence: 0, illicit: 0, jailbreak: 0 };
const saved = { d: env.AI_DAILY_BUDGET_USD, m: env.AI_MONTHLY_BUDGET_USD };
afterEach(async () => {
  await db.delete(spendLedger);
  setStorage(null);
  setModerationClient(async () => ({ flagged: false, scores }));
  Object.assign(env, { IMAGE_BASE_URL: undefined, IMAGE_API_KEY: undefined, IMAGE_MODEL: undefined, AI_DAILY_BUDGET_USD: saved.d, AI_MONTHLY_BUDGET_USD: saved.m });
});

async function setup() {
  Object.assign(env, { IMAGE_BASE_URL: "http://img.test", IMAGE_API_KEY: "k", IMAGE_MODEL: "m", IMAGE_API_STYLE: "images", AI_DAILY_BUDGET_USD: 100, AI_MONTHLY_BUDGET_USD: 100, IMAGE_ESTIMATE_USD: 0.04 });
  setStorage(memoryStorage());
  await seed();
  const lessonVersionId = (await db.select().from(lessons).where(eq(lessons.slug, "lesson-1")))[0]!.currentVersionId!;
  await db.insert(user).values({ id: "u1", name: "T", email: "t@example.com" });
  const learnerId = (await db.insert(learners).values({ userId: "u1" }).returning({ id: learners.id }))[0]!.id;
  return { lessonVersionId, learnerId };
}

test("a generated image's prompt is moderated once", async () => {
  const { lessonVersionId, learnerId } = await setup();
  let moderated = 0;
  setModerationClient(async () => { moderated++; return { flagged: false, scores }; });
  const http = async () => new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
  const r = await generateImage({ lessonVersionId, learnerId, prompt: "one prompt", description: "d", tier: "max" }, http);
  assert.equal(r.status, "ready");
  assert.equal(moderated, 1);
});

test("resolveDocImages resolves blocks in parallel with a cap of four, keeping order", async () => {
  const { lessonVersionId, learnerId } = await setup();
  let active = 0;
  let peak = 0;
  const http = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 40));
    active--;
    return new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 });
  };
  const blocks = Array.from({ length: 8 }, (_, i) => ({ type: "image", id: `b${i}`, props: { source: "generate", prompt: `prompt ${i}`, alt: `alt ${i}` } }));
  const out = (await resolveDocImages({ v: 1, blocks }, { lessonVersionId, learnerId, tier: "max" }, http)) as { blocks: { id: string; props: { source: string } }[] };
  assert.deepEqual(out.blocks.map((b) => b.id), blocks.map((b) => b.id));
  assert.ok(out.blocks.every((b) => b.props.source === "generated"));
  assert.ok(peak > 1 && peak <= 4, `peak concurrency ${peak}`);

  // A second read is served from the batched cache lookup: no provider call at all.
  const again = (await resolveDocImages({ v: 1, blocks }, { lessonVersionId, learnerId, tier: "max" }, async () => { throw new Error("network must not be called"); })) as typeof out;
  assert.ok(again.blocks.every((b) => b.props.source === "generated"));
});
