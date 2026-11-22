import { out, signUp, trpc, withChecks } from "./helpers.ts";
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { lessons } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { idle, LESSON_WRITE_CONCURRENCY } from "../src/ai/service.ts";

const realLesson = engineParts.lesson;
const app = buildApp();
after(() => app.close());

const outline = {
  title: "Learn Rust",
  tagline: "Ownership first",
  courses: [0, 1].map((c) => ({
    title: `Course ${c}`,
    description: "d",
    lessons: [1, 2, 3].map((n) => ({ title: `Lesson ${c}.${n}`, level: n, concepts: ["ownership"], kind: "learn" as const })),
  })),
};
const learnPart = withChecks({ kind: "learn", body: "Variables hold values." });

beforeEach(() => {
  env.ENGINE_TOKEN = "t".repeat(32);
  generator.outline = async () => outline;
  engineParts.lesson = async () => learnPart;
});
afterEach(async () => {
  await idle();
  engineParts.lesson = realLesson;
});

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

async function generate() {
  const t = trpc(app, await signUp(app, "course-writes@example.com"));
  const res = await t.m("paths.generate", { prompt: "learn rust" });
  assert.equal(res.statusCode, 200, res.body);
  return { t, firstCourseSlug: out(res).firstCourseSlug as string };
}

const titled = (lessons: { title: string; writeState: string }[]) => Object.fromEntries(lessons.map((l) => [l.title, l.writeState]));

test("generating a course writes every lesson in the background, before any is opened", async () => {
  let calls = 0;
  engineParts.lesson = async () => (calls++, learnPart);
  await generate();
  await idle();
  const aiLessons = await db.select({ currentVersionId: lessons.currentVersionId }).from(lessons).where(eq(lessons.sourceKind, "ai"));
  assert.equal(aiLessons.length, 6);
  assert.ok(aiLessons.every((l) => l.currentVersionId !== null), "each lesson has a version");
  assert.equal(calls, 6);
});

test("courses.get shows lessons as writing until their write finishes", async () => {
  const release = gate();
  engineParts.lesson = async () => (await release.opened, learnPart);
  const { t, firstCourseSlug } = await generate();
  const writing = out(await t.q("courses.get", { slug: firstCourseSlug }));
  assert.deepEqual(Object.values(titled(writing.lessons)), ["writing", "writing", "writing"]);
  release.open();
  await idle();
  const written = out(await t.q("courses.get", { slug: firstCourseSlug }));
  assert.deepEqual(Object.values(titled(written.lessons)), ["ready", "ready", "ready"]);
});

test("a lesson whose write fails is marked failed, and lessons.write writes it again", async () => {
  let failing = true;
  engineParts.lesson = async (ctx) => {
    if (failing && ctx.lesson.title === "Lesson 0.2") throw new Error("engine down");
    return learnPart;
  };
  const { t, firstCourseSlug } = await generate();
  await idle();
  const failedCourse = out(await t.q("courses.get", { slug: firstCourseSlug }));
  assert.deepEqual(titled(failedCourse.lessons), { "Lesson 0.1": "ready", "Lesson 0.2": "failed", "Lesson 0.3": "ready" });

  failing = false;
  const stuck = failedCourse.lessons.find((l: { title: string }) => l.title === "Lesson 0.2");
  const retry = await t.m("lessons.write", { id: stuck.slug });
  assert.equal(retry.statusCode, 200, retry.body);
  const retried = out(await t.q("courses.get", { slug: firstCourseSlug }));
  assert.equal(retried.lessons.find((l: { title: string }) => l.title === "Lesson 0.2").writeState, "ready");
});

test("background writes run at most LESSON_WRITE_CONCURRENCY at a time", async () => {
  let running = 0;
  let peak = 0;
  engineParts.lesson = async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return learnPart;
  };
  await generate();
  await idle();
  assert.ok(peak >= 2, `writes overlap (peak ${peak})`);
  assert.ok(peak <= LESSON_WRITE_CONCURRENCY, `writes stay within the limit (peak ${peak})`);
});

test("lessons.write refuses a lesson the learner cannot see", async () => {
  const { t, firstCourseSlug } = await generate();
  const slug = out(await t.q("courses.get", { slug: firstCourseSlug })).lessons[0].slug;
  const stranger = trpc(app, await signUp(app, "someone-else@example.com"));
  const res = await stranger.m("lessons.write", { id: slug });
  assert.equal(res.statusCode, 404, res.body);
});
