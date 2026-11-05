import { code, out, signUp, trpc } from "./helpers.ts";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import lesson1 from "../../web/src/player/fixtures/lesson1.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { learners, lessons, steps, user } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { ensureLesson, idle } from "../src/ai/service.ts";
import { setModerationClient } from "../src/safety/moderation.ts";
import photosynthesis from "../../../services/engine/tests/fixtures/outline_photosynthesis.json" with { type: "json" };

const app = buildApp();
after(() => app.close());

const kinds = ["learn", "watch", "practice"] as const;
const outline = {
  title: "Learn Rust",
  tagline: "Ownership first",
  subject: "code",
  courses: [0, 1].map((c) => ({
    title: `Course ${c}`,
    description: "d",
    lessons: [1, 2, 3].map((n) => ({ title: `Lesson ${c}.${n}`, level: n, concepts: ["ownership"], kind: (["learn", "watch", "practice"] as const)[n - 1] })),
  })),
};
const watchInput = lesson1.steps[0]!.input;
const parts = {
  learn: { kind: "learn", body: "Variables hold values." },
  watch: { kind: "watch", beforeFiles: watchInput.beforeFiles, hunks: watchInput.hunks },
  practice: { kind: "practice", instructions: "Write sum(a, b).", starterCode: "function sum(a, b) {}", expectedOutput: "3" },
};
const badWatch = {
  ...parts.watch,
  hunks: parts.watch.hunks.map((h) => ({ ...h, lines: [" not in the file", "+x"] })),
};

let lessonCalls = 0;
let lessonOut: (kind: string) => unknown;
beforeEach(() => {
  env.ANTHROPIC_API_KEY = "test-key";
  lessonCalls = 0;
  lessonOut = (kind) => parts[kind as keyof typeof parts];
  generator.outline = async () => outline;
  // Non-predict parts come from the engine. Each call counts as one model call for these tests.
  engineParts.lesson = async (ctx) => {
    lessonCalls++;
    await new Promise((r) => setTimeout(r, 30));
    return lessonOut(ctx.lesson.kind);
  };
});

async function setup(email = "a@example.com") {
  const t = trpc(app, await signUp(app, email));
  const res = await t.m("paths.generate", { prompt: "learn rust" });
  assert.equal(res.statusCode, 200, res.body);
  const { slug, firstCourseSlug } = out(res);
  const course = out(await t.q("courses.get", { slug: firstCourseSlug }));
  return { t, slug, firstCourseSlug, lessons: course.lessons as { slug: string }[] };
}

test("outline creates a private path, courses, draft lessons and an enrollment", async () => {
  const { t, slug, firstCourseSlug, lessons: ls } = await setup();
  assert.equal(ls.length, 3);
  const path = out(await t.q("paths.get", { slug }));
  assert.deepEqual([path.origin, path.visibility, path.mine, path.enrolled, path.courses.length], ["ai", "private", true, true, 2]);
  const rows = await db.select().from(lessons).where(eq(lessons.slug, ls[0]!.slug));
  assert.deepEqual([rows[0]!.status, rows[0]!.sourceKind, rows[0]!.currentVersionId, rows[0]!.concepts, rows[0]!.kind], ["draft", "ai", null, ["ownership"], "learn"]);

  const other = trpc(app, await signUp(app, "b@example.com"));
  assert.equal(code(await other.q("paths.get", { slug })), "NOT_FOUND");
  assert.equal(code(await other.q("courses.get", { slug: firstCourseSlug })), "NOT_FOUND");
  assert.equal(code(await other.q("lessons.get", { id: ls[0]!.slug })), "NOT_FOUND");
  assert.equal(out(await other.q("paths.list", { scope: "community" })).length, 0);
});

test("photosynthesis outline persists only non-coding lesson kinds", async () => {
  const fixture = photosynthesis as typeof outline;
  generator.outline = async () => fixture;
  const { t, firstCourseSlug } = await setup("photosynthesis@example.com");
  const course = out(await t.q("courses.get", { slug: firstCourseSlug }));
  assert.deepEqual((course.lessons as { title: string; kind: string }[]).map(({ title, kind }) => [title, kind]),
    fixture.courses[0]!.lessons.map(({ title, kind }) => [title, kind]));
  assert.deepEqual(new Set((course.lessons as { kind: string }[]).map(({ kind }) => kind)), new Set(["learn", "game-practice"]));
});

test("a non-coding outline with a watch lesson is rejected", async () => {
  const t = trpc(app, await signUp(app, "noncode-watch@example.com"));
  const bad = structuredClone(photosynthesis) as typeof outline;
  bad.courses[0]!.lessons[0]!.kind = "watch";
  generator.outline = async () => bad;
  assert.equal(code(await t.m("paths.generate", { prompt: "learn photosynthesis" })), "INTERNAL_SERVER_ERROR");
});

test("missing key, non-coding topic and bad input", async () => {
  const t = trpc(app, await signUp(app));
  env.ANTHROPIC_API_KEY = undefined;
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "PRECONDITION_FAILED");
  env.ANTHROPIC_API_KEY = "k";
  generator.outline = async () => ({ refused: true });
  const res = await t.m("paths.generate", { prompt: "baking sourdough" });
  assert.equal(code(res), "BAD_REQUEST");
  assert.match(res.json().error.message, /that request/i);
  assert.equal(code(await t.m("paths.generate", { prompt: "hi" })), "BAD_REQUEST");
  generator.outline = async () => ({ title: "x", tagline: "y", courses: [] }); // fails schema
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "INTERNAL_SERVER_ERROR");
});

test("at most 5 generated paths per rolling day", async () => {
  const t = trpc(app, await signUp(app));
  for (let i = 0; i < 5; i++) assert.equal((await t.m("paths.generate", { prompt: "learn rust" })).statusCode, 200);
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "TOO_MANY_REQUESTS");
});

test("the plan tier sets the daily AI path limit", async () => {
  const email = "tier@example.com";
  const t = trpc(app, await signUp(app, email));
  for (let i = 0; i < 5; i++) assert.equal((await t.m("paths.generate", { prompt: "learn rust" })).statusCode, 200);
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "TOO_MANY_REQUESTS");

  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  await db.update(learners).set({ tier: "pro" }).where(eq(learners.userId, u!.id));
  assert.equal((await t.m("paths.generate", { prompt: "learn rust" })).statusCode, 200);
});

test("rejected topics use up the daily limit too", async () => {
  const t = trpc(app, await signUp(app));
  generator.outline = async () => ({ refused: true });
  for (let i = 0; i < 5; i++) assert.equal(code(await t.m("paths.generate", { prompt: "baking bread" })), "BAD_REQUEST");
  generator.outline = async () => outline;
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "TOO_MANY_REQUESTS");
});

test("a parallel burst cannot exceed the daily limit", async () => {
  const t = trpc(app, await signUp(app));
  const res = await Promise.all(Array.from({ length: 8 }, () => t.m("paths.generate", { prompt: "learn rust" })));
  assert.equal(res.filter((r) => r.statusCode === 200).length, 5);
});

test("two concurrent plays write the part once", async () => {
  const { t, lessons: ls } = await setup();
  const last = ls[2]!.slug;
  const [a, b] = await Promise.all([t.q("lessons.get", { id: last }), t.q("lessons.get", { id: last })]);
  assert.equal(a.statusCode, 200, a.body);
  assert.deepEqual(out(a), out(b));
  assert.equal(out(a).kind, "practice");
  const { expectedOutput: _hidden, ...visiblePractice } = parts.practice; // the router hides the expected output
  assert.deepEqual(out(a).part, { ...visiblePractice, language: "javascript" }); // and defaults the language
  assert.deepEqual(out(a).steps, []);
  assert.equal(lessonCalls, 1);
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, last));
  assert.equal(row!.status, "published");
  assert.equal((await db.select().from(steps)).length, 3); // only seeded lesson-1
});

test("playing a part writes only that part, not the next one", async () => {
  const { t, lessons: ls } = await setup();
  assert.equal((await t.q("lessons.get", { id: ls[0]!.slug })).statusCode, 200);
  await idle(); // the background prefetch must have run (and skipped the part) before we look
  assert.equal(lessonCalls, 1);
  const [next] = await db.select().from(lessons).where(eq(lessons.slug, ls[1]!.slug));
  assert.equal(next!.currentVersionId, null);
  assert.equal(next!.status, "draft");
});

test("concurrent ensureLesson calls for one lesson make one call and reserve once", { timeout: 15_000 }, async () => {
  const { lessons: ls } = await setup("burst@example.com");
  const [lesson] = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.slug, ls[0]!.slug));
  const [learner] = await db.select({ id: learners.id }).from(learners);
  await db.execute(sql`DELETE FROM spend_ledger`); // drop the outline's reservation
  assert.deepEqual(await Promise.all([ensureLesson(lesson!.id, learner!.id), ensureLesson(lesson!.id, learner!.id)]), [true, true]);
  assert.equal(lessonCalls, 1);
  const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM spend_ledger`)).rows;
  assert.equal(n, 1);
  assert.equal(await ensureLesson(lesson!.id, learner!.id), false); // already written: no call, no reservation
  assert.equal(lessonCalls, 1);
});

test("invalid watch hunks are rejected after one retry, and a good retry succeeds", async () => {
  const { t, lessons: ls } = await setup();
  const watch = ls[1]!.slug;
  lessonOut = () => badWatch;
  const res = await t.q("lessons.get", { id: watch });
  assert.equal(code(res), "INTERNAL_SERVER_ERROR");
  assert.equal(lessonCalls, 2);
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, watch));
  assert.deepEqual([row!.status, row!.currentVersionId], ["draft", null]);

  lessonCalls = 0;
  lessonOut = () => (lessonCalls === 1 ? badWatch : parts.watch);
  const ok = out(await t.q("lessons.get", { id: watch }));
  assert.deepEqual([ok.kind, ok.part], ["watch", parts.watch]);
  assert.equal(lessonCalls, 2);
});

test("a truncated learn body is regenerated", async () => {
  const { t, lessons: ls } = await setup();
  const first = ls[0]!.slug;
  lessonOut = () => (lessonCalls === 1 ? { kind: "learn", body: "Use `let` like `" } : parts.learn);
  const res = out(await t.q("lessons.get", { id: first }));
  assert.deepEqual([res.kind, res.part], ["learn", parts.learn]);
  assert.equal(lessonCalls, 2);
});

test("a looping learn body is regenerated", async () => {
  const { t, lessons: ls } = await setup();
  const first = ls[0]!.slug;
  const looping = { kind: "learn", body: "Your First Python Program# ".repeat(200) };
  lessonOut = () => (lessonCalls === 1 ? looping : parts.learn);
  const res = out(await t.q("lessons.get", { id: first }));
  assert.deepEqual([res.kind, res.part], ["learn", parts.learn]);
  assert.equal(lessonCalls, 2);
});

test("private AI lesson is hidden from others until the path is published", async () => {
  const { t, slug, lessons: ls } = await setup();
  const last = ls[2]!.slug;
  assert.equal((await t.q("lessons.get", { id: last })).statusCode, 200);
  const other = trpc(app, await signUp(app, "b@example.com"));
  assert.equal(code(await other.q("lessons.get", { id: last })), "NOT_FOUND");

  assert.equal((await t.m("paths.publish", { slug })).statusCode, 200);
  assert.equal((await other.q("lessons.get", { id: last })).statusCode, 200);
});

test("a part generated for one learner is reused by another without a model call", async () => {
  const first = await setup("c@example.com");
  assert.equal((await first.t.q("lessons.get", { id: first.lessons[0]!.slug })).statusCode, 200);
  await idle(); // background prefetch of neighbouring lessons also calls the engine
  const before = lessonCalls;

  const second = await setup("d@example.com");
  const res = out(await second.t.q("lessons.get", { id: second.lessons[0]!.slug }));
  assert.deepEqual(res.part, parts.learn);
  assert.equal(lessonCalls, before); // same lesson content, so the cached part is served
  await idle();
});

test("a learn part's visual document is stored and returned", async () => {
  const doc = { v: 1, blocks: [{ type: "text", id: "t", props: { md: "Ownership moves values." } }] };
  lessonOut = (kind) => (kind === "learn" ? { kind: "learn", body: "Variables hold values.", doc } : parts[kind as keyof typeof parts]);
  const { t, lessons: ls } = await setup();
  const res = out(await t.q("lessons.get", { id: ls[0]!.slug }));
  assert.equal(res.part.kind, "learn");
  assert.deepEqual((res.part.doc as { blocks: { id: string }[] }).blocks.map((b) => b.id), ["t"]);
});

test("the AI budget stops a lesson with its own message, before the model call and without a retry", async () => {
  await db.execute(sql`DELETE FROM spend_ledger`);
  const old = { daily: env.AI_DAILY_BUDGET_USD, estimate: env.AI_CALL_ESTIMATE_USD };
  try {
    env.AI_CALL_ESTIMATE_USD = 0.01;
    env.AI_DAILY_BUDGET_USD = 0.045; // outline 0.01, first part 0.03 (three engine calls); the second part would reach 0.07
    const { t, lessons: ls } = await setup();
    assert.equal((await t.q("lessons.get", { id: ls[0]!.slug })).statusCode, 200);
    assert.equal(lessonCalls, 1);
    const res = await t.q("lessons.get", { id: ls[1]!.slug });
    assert.equal(code(res), "TOO_MANY_REQUESTS");
    assert.equal(res.json().error.message, "AI budget limit reached");
    assert.equal(lessonCalls, 1);
  } finally {
    env.AI_DAILY_BUDGET_USD = old.daily;
    env.AI_CALL_ESTIMATE_USD = old.estimate;
    await idle();
    await db.execute(sql`DELETE FROM spend_ledger`);
  }
});

test("a budget refusal does not consume a daily AI path", async () => {
  await db.execute(sql`DELETE FROM spend_ledger`);
  const old = env.AI_DAILY_BUDGET_USD;
  try {
    env.AI_DAILY_BUDGET_USD = 0.001;
    env.AI_CALL_ESTIMATE_USD = 0.01;
    const t = trpc(app, await signUp(app, "budget@example.com"));
    const [{ n: before }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ai_generations`)).rows;
    assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "TOO_MANY_REQUESTS");
    const [{ n: after }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ai_generations`)).rows;
    assert.equal(after, before);
  } finally {
    env.AI_DAILY_BUDGET_USD = old;
    await db.execute(sql`DELETE FROM spend_ledger`);
  }
});

test("flagged generated lesson text is rejected and not saved", async () => {
  const clean = { flagged: false, scores: { hate: 0, harassment: 0, "self-harm": 0, sexual: 0, violence: 0, illicit: 0, jailbreak: 0 } };
  setModerationClient(async (input) => ({ ...clean, flagged: input.includes("Variables hold values") }));
  try {
    const { t, lessons: ls } = await setup();
    assert.equal(code(await t.q("lessons.get", { id: ls[0]!.slug })), "INTERNAL_SERVER_ERROR");
    const rows = await db.select().from(lessons).where(eq(lessons.slug, ls[0]!.slug));
    assert.equal(rows[0]!.currentVersionId, null);
  } finally {
    setModerationClient(async () => clean);
    await idle();
  }
});

test("lessons.get returns the lesson with its image prompt resolved", async () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  const srv = createServer((req, res) => { req.resume(); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ b64_json: PNG }] })); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const old = { u: env.IMAGE_BASE_URL, k: env.IMAGE_API_KEY, m: env.IMAGE_MODEL, s: env.IMAGE_API_STYLE };
  Object.assign(env, { IMAGE_BASE_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, IMAGE_API_KEY: "k", IMAGE_MODEL: "m", IMAGE_API_STYLE: "images" });
  try {
    const doc = { v: 1, blocks: [{ type: "image", id: "i", props: { source: "generate", prompt: "A slow cell", alt: "cell" } }] };
    lessonOut = (kind) => (kind === "learn" ? { kind: "learn", body: "Variables hold values.", doc } : parts[kind as keyof typeof parts]);
    const { t, lessons: ls } = await setup();
    assert.equal((await t.q("lessons.get", { id: ls[0]!.slug })).statusCode, 200);
  } finally {
    await idle();
    Object.assign(env, { IMAGE_BASE_URL: old.u, IMAGE_API_KEY: old.k, IMAGE_MODEL: old.m, IMAGE_API_STYLE: old.s });
    await new Promise((r) => srv.close(r));
  }
});
