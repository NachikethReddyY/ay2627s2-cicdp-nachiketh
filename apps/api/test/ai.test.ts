import { code, out, signUp, trpc } from "./helpers.ts";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import lesson1 from "../../web/src/player/fixtures/lesson1.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { lessons, steps } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";
import { idle } from "../src/ai/service.ts";

const app = buildApp();
after(() => app.close());

const outline = {
  title: "Learn Rust",
  tagline: "Ownership first",
  courses: [0, 1].map((c) => ({
    title: `Course ${c}`,
    description: "d",
    lessons: [1, 2, 3].map((n) => ({ title: `Lesson ${c}.${n}`, level: n, concepts: ["ownership"] })),
  })),
};
const goodLesson = {
  steps: lesson1.steps.map((s) => ({
    title: s.title,
    prompt: s.prompt,
    kind: s.kind,
    options: s.options,
    answer: s.answer,
    accepted: s.accepted,
    beforeFiles: s.input.beforeFiles,
    hunks: s.input.hunks,
    hints: s.hints,
    explanations: s.explanations,
    concepts: ["reduce"],
  })),
};
const badLesson = {
  steps: goodLesson.steps.map((s) => ({ ...s, hunks: [{ ...s.hunks[0]!, lines: [" not in the file", "+x"] }] })),
};

let lessonCalls = 0;
let lessonOut: () => unknown;
beforeEach(() => {
  env.ANTHROPIC_API_KEY = "test-key";
  lessonCalls = 0;
  lessonOut = () => goodLesson;
  generator.outline = async () => outline;
  generator.lesson = async () => {
    lessonCalls++;
    await new Promise((r) => setTimeout(r, 30));
    return lessonOut();
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
  assert.deepEqual([rows[0]!.status, rows[0]!.sourceKind, rows[0]!.currentVersionId, rows[0]!.concepts], ["draft", "ai", null, ["ownership"]]);

  const other = trpc(app, await signUp(app, "b@example.com"));
  assert.equal(code(await other.q("paths.get", { slug })), "NOT_FOUND");
  assert.equal(code(await other.q("courses.get", { slug: firstCourseSlug })), "NOT_FOUND");
  assert.equal(code(await other.q("lessons.get", { id: ls[0]!.slug })), "NOT_FOUND");
  assert.equal(out(await other.q("paths.list", { scope: "community" })).length, 0);
});

test("missing key, non-coding topic and bad input", async () => {
  const t = trpc(app, await signUp(app));
  env.ANTHROPIC_API_KEY = undefined;
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "PRECONDITION_FAILED");
  env.ANTHROPIC_API_KEY = "k";
  generator.outline = async () => ({ notCoding: true });
  const res = await t.m("paths.generate", { prompt: "baking sourdough" });
  assert.equal(code(res), "BAD_REQUEST");
  assert.match(res.json().error.message, /coding topics/);
  assert.equal(code(await t.m("paths.generate", { prompt: "hi" })), "BAD_REQUEST");
  generator.outline = async () => ({ title: "x", tagline: "y", courses: [] }); // fails schema
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "INTERNAL_SERVER_ERROR");
});

test("at most 5 generated paths per rolling day", async () => {
  const t = trpc(app, await signUp(app));
  for (let i = 0; i < 5; i++) assert.equal((await t.m("paths.generate", { prompt: "learn rust" })).statusCode, 200);
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "TOO_MANY_REQUESTS");
});

test("rejected topics use up the daily limit too", async () => {
  const t = trpc(app, await signUp(app));
  generator.outline = async () => ({ notCoding: true });
  for (let i = 0; i < 5; i++) assert.equal(code(await t.m("paths.generate", { prompt: "baking bread" })), "BAD_REQUEST");
  generator.outline = async () => outline;
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "TOO_MANY_REQUESTS");
});

test("a parallel burst cannot exceed the daily limit", async () => {
  const t = trpc(app, await signUp(app));
  const res = await Promise.all(Array.from({ length: 8 }, () => t.m("paths.generate", { prompt: "learn rust" })));
  assert.equal(res.filter((r) => r.statusCode === 200).length, 5);
});

test("two concurrent plays write the steps once", async () => {
  const { t, lessons: ls } = await setup();
  const last = ls[2]!.slug; // no next lesson, so no background generation
  const [a, b] = await Promise.all([t.q("lessons.get", { id: last }), t.q("lessons.get", { id: last })]);
  assert.equal(a.statusCode, 200, a.body);
  assert.deepEqual(out(a), out(b));
  assert.equal(out(a).steps.length, 3);
  assert.equal(lessonCalls, 1);
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, last));
  assert.equal(row!.status, "published");
  assert.equal((await db.select().from(steps)).length, 3 + 3); // + seeded lesson-1

  // Steps are readable by the owner and wrong answers record the step's concepts.
  const stepId = out(a).steps[0].id;
  assert.equal(out(await t.q("steps.get", { id: stepId })).kind, "mcq");
  const wrong = await t.m("steps.attempt", { id: stepId, answer: { kind: "mcq", choice: 0 } });
  assert.deepEqual([out(wrong).correct, out(wrong).missedConcepts], [false, ["reduce"]]);
  await t.m("steps.skip", { id: stepId });
  assert.equal(out(await t.q("steps.reveal", { id: stepId })).source, null);
});

test("playing a lesson writes the next one in the background", async () => {
  const { t, lessons: ls } = await setup();
  assert.equal((await t.q("lessons.get", { id: ls[0]!.slug })).statusCode, 200);
  await idle();
  assert.equal(lessonCalls, 2);
  const [next] = await db.select().from(lessons).where(eq(lessons.slug, ls[1]!.slug));
  assert.equal(next!.status, "published");
  assert.ok(next!.currentVersionId);
  const [third] = await db.select().from(lessons).where(eq(lessons.slug, ls[2]!.slug));
  assert.equal(third!.currentVersionId, null);
});

test("invalid hunks are rejected after one retry, and a good retry succeeds", async () => {
  const { t, lessons: ls } = await setup();
  const last = ls[2]!.slug;
  lessonOut = () => badLesson;
  const res = await t.q("lessons.get", { id: last });
  assert.equal(code(res), "INTERNAL_SERVER_ERROR");
  assert.equal(lessonCalls, 2);
  assert.equal((await db.select().from(steps)).length, 3); // only seeded lesson-1
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, last));
  assert.deepEqual([row!.status, row!.currentVersionId], ["draft", null]);

  lessonCalls = 0;
  lessonOut = () => (lessonCalls === 1 ? badLesson : goodLesson);
  assert.equal((await t.q("lessons.get", { id: last })).statusCode, 200);
  assert.equal(lessonCalls, 2);
});

test("private AI lesson is hidden from others until the path is published", async () => {
  const { t, slug, lessons: ls } = await setup();
  const last = ls[2]!.slug;
  const stepId = out(await t.q("lessons.get", { id: last })).steps[0].id;
  const other = trpc(app, await signUp(app, "b@example.com"));
  assert.equal(code(await other.q("lessons.get", { id: last })), "NOT_FOUND");
  assert.equal(code(await other.q("steps.get", { id: stepId })), "NOT_FOUND");

  assert.equal((await t.m("paths.publish", { slug })).statusCode, 200);
  assert.equal((await other.q("lessons.get", { id: last })).statusCode, 200);
  assert.equal((await other.q("steps.get", { id: stepId })).statusCode, 200);
});
