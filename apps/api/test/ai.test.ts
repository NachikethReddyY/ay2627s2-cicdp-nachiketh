import { code, out, signUp, trpc } from "./helpers.ts";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import lesson1 from "../../web/src/player/fixtures/lesson1.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { learners, lessons, steps, user } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";
import { idle } from "../src/ai/service.ts";
import photosynthesis from "../../../services/engine/tests/fixtures/outline_photosynthesis.json" with { type: "json" };

const app = buildApp();
after(() => app.close());

const kinds = ["learn", "watch", "practice"] as const;
const outline = {
  title: "Learn Rust",
  tagline: "Ownership first",
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
  generator.lesson = async (ctx) => {
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

test("photosynthesis outline persists the supported lesson kinds", async () => {
  const fixture = photosynthesis as typeof outline;
  generator.outline = async () => fixture;
  const { t, firstCourseSlug } = await setup("photosynthesis@example.com");
  const course = out(await t.q("courses.get", { slug: firstCourseSlug }));
  assert.deepEqual((course.lessons as { title: string; kind: string }[]).map(({ title, kind }) => [title, kind]),
    fixture.courses[0]!.lessons.map(({ title, kind }) => [title, kind]));
  assert.deepEqual(new Set((course.lessons as { kind: string }[]).map(({ kind }) => kind)), new Set(["learn", "watch", "practice"]));
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
  assert.deepEqual(out(a).part, parts.practice);
  assert.deepEqual(out(a).steps, []);
  assert.equal(lessonCalls, 1);
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, last));
  assert.equal(row!.status, "published");
  assert.equal((await db.select().from(steps)).length, 3); // only seeded lesson-1
});

test("playing a part writes only that part, not the next one", async () => {
  const { t, lessons: ls } = await setup();
  assert.equal((await t.q("lessons.get", { id: ls[0]!.slug })).statusCode, 200);
  assert.equal(lessonCalls, 1);
  const [next] = await db.select().from(lessons).where(eq(lessons.slug, ls[1]!.slug));
  assert.equal(next!.currentVersionId, null);
  assert.equal(next!.status, "draft");
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
