import "./helpers.ts";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { env } from "../src/env.ts";
import { db } from "../src/db/client.ts";
import { seed } from "../src/db/seed.ts";
import { learners, lessons, spendLedger, user } from "../src/db/schema.ts";
import { generateImage, idleImages, resolveDocImages, prewarmDocImages } from "../src/media/imagegen.ts";
import { memoryStorage, setStorage } from "../src/media/storage.ts";
import { setModerationClient } from "../src/safety/moderation.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");
const base = { prompt: "A cell diagram, labelled", description: "Cell diagram", tier: "free" as const };
const noNetwork = async () => { throw new Error("network must not be called"); };
const clean = async () => ({ flagged: false, scores: { hate: 0, harassment: 0, "self-harm": 0, sexual: 0, violence: 0, illicit: 0, jailbreak: 0 } });
const versionId = async () => { await seed(); return (await db.select().from(lessons).where(eq(lessons.slug, "lesson-1")))[0]!.currentVersionId!; };

const learnerId_ = async () => {
  await db.insert(user).values({ id: "u1", name: "T", email: "t@example.com" });
  return (await db.insert(learners).values({ userId: "u1" }).returning({ id: learners.id }))[0]!.id;
};

const servers: Server[] = [];
async function fake(style: "images" | "chat", reply: { status?: number; body?: unknown } = {}) {
  const calls: { url?: string; body: any }[] = [];
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ url: req.url, body: JSON.parse(raw) });
      res.statusCode = reply.status ?? 200;
      res.setHeader("content-type", "application/json");
      res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? (style === "images" ? { data: [{ b64_json: PNG }] } : { choices: [{ message: { content: PNG } }] })));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  servers.push(srv);
  return { calls, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}
const configure = (url: string, style: "images" | "chat") =>
  Object.assign(env, { IMAGE_BASE_URL: url, IMAGE_API_KEY: "test-key", IMAGE_MODEL: "test-model", IMAGE_API_STYLE: style, AI_DAILY_BUDGET_USD: 100, AI_MONTHLY_BUDGET_USD: 100, IMAGE_ESTIMATE_USD: 0.04 });
const saved = { AI_KILL_SWITCH: env.AI_KILL_SWITCH, AI_DAILY_BUDGET_USD: env.AI_DAILY_BUDGET_USD, AI_MONTHLY_BUDGET_USD: env.AI_MONTHLY_BUDGET_USD, IMAGE_ESTIMATE_USD: env.IMAGE_ESTIMATE_USD };
afterEach(async () => {
  await db.delete(spendLedger); // image spend would otherwise leak into the other suites
  setModerationClient(clean);
  setStorage(null);
  Object.assign(env, { IMAGE_BASE_URL: undefined, IMAGE_API_KEY: undefined, IMAGE_MODEL: undefined, ...saved });
});
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

test("no image settings returns the marked description fallback without a network call", async () => {
  setModerationClient(clean);
  assert.deepEqual(await generateImage({ ...base, lessonVersionId: "v1", learnerId: "none" }, noNetwork), { status: "fallback", description: "Cell diagram", marked: true });
});

test("a flagged prompt is refused before any network call", async () => {
  configure("https://images.example.test", "images");
  setModerationClient(async () => ({ flagged: true, scores: {} }));
  assert.equal((await generateImage({ ...base, lessonVersionId: "v1", learnerId: "none" }, noNetwork)).status, "fallback");
});

for (const style of ["images", "chat"] as const) {
  test(`ready path through a fake ${style} server`, async () => {
    const f = await fake(style);
    configure(f.url, style);
    setModerationClient(clean);
    const mem = memoryStorage();
    setStorage(mem);
    const r = await generateImage({ ...base, lessonVersionId: await versionId(), learnerId: await learnerId_() });
    assert.equal(r.status, "ready");
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]!.url, style === "images" ? "/images/generations" : "/chat/completions");
    assert.equal(mem.objects.size, 1);
  });
}

test("the same prompt is served from the cache with zero provider calls", async () => {
  const f = await fake("images");
  configure(f.url, "images");
  setModerationClient(clean);
  setStorage(memoryStorage());
  const lessonVersionId = await versionId();
  const learnerId = await learnerId_();
  const first = await generateImage({ ...base, lessonVersionId, learnerId });
  const second = await generateImage({ ...base, lessonVersionId, learnerId }, noNetwork);
  assert.deepEqual(second, first);
  assert.equal(f.calls.length, 1);
});

test("over budget or kill switch falls back with no HTTP call", async () => {
  const f = await fake("images");
  configure(f.url, "images");
  setModerationClient(clean);
  const learnerId = await learnerId_();
  Object.assign(env, { AI_DAILY_BUDGET_USD: 0.001 }); // a positive limit below the image estimate; 0 would mean unlimited
  assert.equal((await generateImage({ ...base, lessonVersionId: "v1", learnerId })).status, "fallback");
  Object.assign(env, { ...saved, AI_KILL_SWITCH: true });
  assert.equal((await generateImage({ ...base, lessonVersionId: "v1", learnerId })).status, "fallback");
  assert.equal(f.calls.length, 0);
});

test("resolveDocImages rewrites generate blocks for the client and never leaks the prompt", async () => {
  const f = await fake("images");
  configure(f.url, "images");
  setModerationClient(clean);
  setStorage(memoryStorage());
  const secret = "SECRET-PROMPT-TEXT";
  const doc = { v: 1, blocks: [
    { type: "text", id: "t", props: { md: "hi" } },
    { type: "image", id: "a", props: { source: "asset", assetId: "ast_1", alt: "Asset" } },
    { type: "image", id: "g", props: { source: "generate", prompt: secret, alt: "A cell", caption: "Cap" } },
    { type: "image", id: "bad", props: { source: "generate", alt: "no prompt" } },
    { type: "image", id: "forged", props: { source: "generated", url: "https://evil.test/x.png", alt: "forged" } },
    { type: "image", id: "nil" },
  ] };
  const lessonVersionId = await versionId();
  const learnerId = await learnerId_();
  const first = (await resolveDocImages(doc, { lessonVersionId, learnerId, tier: "free" })) as typeof doc;
  assert.deepEqual(first.blocks.map((b) => b.id), ["t", "a", "g"]);
  assert.equal((first.blocks[2]!.props as any).source, "generated-pending", "a read does not wait on the provider");
  await idleImages(); // generation runs after the read returns
  const out = (await resolveDocImages(doc, { lessonVersionId, learnerId, tier: "free" })) as typeof doc;
  assert.deepEqual(out.blocks.map((b) => b.id), ["t", "a", "g"]);
  const g = out.blocks[2]!.props as any;
  assert.equal(g.source, "generated");
  assert.match(g.url, /^memory:\/\/v\//);
  assert.equal(g.caption, "Cap");
  assert.ok(!JSON.stringify(out).includes(secret));
  assert.ok(!JSON.stringify(out).includes('"prompt"'));
  assert.ok(JSON.stringify(doc).includes(secret), "input doc is not mutated");

  Object.assign(env, { IMAGE_BASE_URL: undefined, IMAGE_API_KEY: undefined, IMAGE_MODEL: undefined });
  const pending = (await resolveDocImages({ v: 1, blocks: [{ type: "image", id: "g", props: { source: "generate", prompt: "other prompt", alt: "A cell" } }] }, { lessonVersionId, learnerId, tier: "free" })) as typeof doc;
  assert.deepEqual(pending.blocks[0]!.props, { source: "generated-pending", alt: "A cell" });
});

test("the daily cap returns the fallback with no provider call once reached", async () => {
  const f = await fake("images");
  configure(f.url, "images");
  setStorage(memoryStorage());
  const lessonVersionId = await versionId();
  const learnerId = await learnerId_();
  assert.equal((await generateImage({ ...base, prompt: "first", lessonVersionId, learnerId })).status, "ready"); // free tier: 1 per day
  assert.equal((await generateImage({ ...base, prompt: "second", lessonVersionId, learnerId })).status, "fallback");
  assert.equal(f.calls.length, 1);
});

test("a failed generation is not retried for the same prompt", async () => {
  const f = await fake("images", { status: 500, body: {} });
  configure(f.url, "images");
  setStorage(memoryStorage());
  const lessonVersionId = await versionId();
  const learnerId = await learnerId_();
  assert.equal((await generateImage({ ...base, lessonVersionId, learnerId })).status, "fallback");
  assert.equal((await generateImage({ ...base, lessonVersionId, learnerId })).status, "fallback");
  assert.equal(f.calls.length, 1);
});

test("a prompt with a recent failed row does not call moderation", async () => {
  const f = await fake("images", { status: 500, body: {} });
  configure(f.url, "images");
  setStorage(memoryStorage());
  const lessonVersionId = await versionId();
  const learnerId = await learnerId_();
  let moderated = 0;
  setModerationClient(async () => { moderated++; return clean(); });
  await generateImage({ ...base, lessonVersionId, learnerId });
  const before = moderated;
  assert.equal((await generateImage({ ...base, lessonVersionId, learnerId })).status, "fallback");
  assert.equal(moderated, before);
});

test("an oversized provider response is rejected as a failure", async () => {
  const f = await fake("images", { body: JSON.stringify({ data: [{ b64_json: "A".repeat(4 * 1024 * 1024 + 1) }] }) });
  configure(f.url, "images");
  const mem = memoryStorage();
  setStorage(mem);
  const r = await generateImage({ ...base, lessonVersionId: await versionId(), learnerId: await learnerId_() });
  assert.equal(r.status, "fallback");
  assert.equal(mem.objects.size, 0);
});

for (const [name, b64, type] of [["PNG", PNG, "image/png"], ["JPEG", JPEG, "image/jpeg"]] as const) {
  test(`${name} magic bytes are accepted and stored with a matching content type`, async () => {
    const f = await fake("chat", { body: { choices: [{ message: { content: `data:${type};base64,${b64}` } }] } });
    configure(f.url, "chat");
    const mem = memoryStorage();
    setStorage(mem);
    const r = await generateImage({ ...base, lessonVersionId: await versionId(), learnerId: await learnerId_() });
    assert.equal(r.status, "ready");
    assert.equal([...mem.objects.values()][0]!.contentType, type);
  });
}

const chatShapes: Array<[string, unknown]> = [
  ["content as an array of image parts", { choices: [{ message: { content: [{ type: "text", text: "Here it is" }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] } }] }],
  ["content as Markdown with an embedded image", { choices: [{ message: { content: `Here: ![plant cell](data:image/png;base64,${PNG})` } }] }],
  ["an images field on the message", { choices: [{ message: { content: "", images: [{ image_url: { url: `data:image/png;base64,${PNG}` } }] } }] }],
];
for (const [name, body] of chatShapes) {
  test(`chat reply with ${name} is read as the picture`, async () => {
    const f = await fake("chat", { body });
    configure(f.url, "chat");
    const mem = memoryStorage();
    setStorage(mem);
    const r = await generateImage({ ...base, lessonVersionId: await versionId(), learnerId: await learnerId_() });
    assert.equal(r.status, "ready");
    assert.equal([...mem.objects.values()][0]!.contentType, "image/png");
  });
}

test("concurrent requests for one prompt share a single provider call", async () => {
  const f = await fake("images");
  configure(f.url, "images");
  setStorage(memoryStorage());
  const opts = { lessonVersionId: await versionId(), learnerId: await learnerId_(), tier: "max" as const };
  const results = await Promise.all([generateImage({ ...base, ...opts }), generateImage({ ...base, ...opts })]);
  assert.equal(f.calls.length, 1);
  assert.ok(results.every((r) => r.status === "ready"));
});

test("concurrent requests for one prompt from two learners share a single provider call", async () => {
  const f = await fake("images");
  configure(f.url, "images");
  setStorage(memoryStorage());
  const lessonVersionId = await versionId();
  const a = await learnerId_();
  await db.insert(user).values({ id: "u2", name: "T2", email: "t2@example.com" });
  const b = (await db.insert(learners).values({ userId: "u2" }).returning({ id: learners.id }))[0]!.id;
  const results = await Promise.all([
    generateImage({ ...base, lessonVersionId, learnerId: a, tier: "max" as const }),
    generateImage({ ...base, lessonVersionId, learnerId: b, tier: "max" as const }),
  ]);
  assert.equal(f.calls.length, 1);
  assert.ok(results.every((r) => r.status === "ready"));
});

test("prewarm generates each image once, so a later read costs no provider call", async () => {
  const f = await fake("images");
  configure(f.url, "images");
  const mem = memoryStorage();
  setStorage(mem);
  const doc = {
    v: 1,
    blocks: [
      { type: "image", id: "a", props: { source: "generate", prompt: "A cell, flat colours", alt: "A cell" } },
      { type: "image", id: "b", props: { source: "generate", prompt: "A leaf, flat colours", alt: "A leaf" } },
    ],
  };
  const opts = { lessonVersionId: await versionId(), learnerId: await learnerId_(), tier: "max" as const }; // free allows one image a day
  await prewarmDocImages(doc, opts);
  assert.equal(f.calls.length, 2);
  const shown = await resolveDocImages(doc, opts);
  assert.equal(f.calls.length, 2, "reads are served from the cache");
  assert.ok(JSON.stringify(shown).includes('"generated"'));
  assert.ok(!JSON.stringify(shown).includes("flat colours"), "prompt never appears in the client doc");
});
