import { code, out, signUp, trpc } from "./helpers.ts";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { aiGenerations } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";

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

let outlineCalls = 0;
let lessonCalls = 0;
beforeEach(() => {
  env.ANTHROPIC_API_KEY = "test-key";
  env.AI_KILL_SWITCH = false;
  outlineCalls = 0;
  lessonCalls = 0;
  generator.outline = async () => {
    outlineCalls++;
    return outline;
  };
  generator.lesson = async () => {
    lessonCalls++;
    return {};
  };
});

test("AI kill switch blocks outline generation before spending a slot", async () => {
  const t = trpc(app, await signUp(app));
  const before = (await db.select().from(aiGenerations)).length;
  env.AI_KILL_SWITCH = true;
  assert.equal(code(await t.m("paths.generate", { prompt: "learn rust" })), "PRECONDITION_FAILED");
  assert.equal(outlineCalls, 0);
  assert.equal((await db.select().from(aiGenerations)).length, before);
});

test("AI kill switch blocks lazy lesson generation", async () => {
  const t = trpc(app, await signUp(app));
  const generated = await t.m("paths.generate", { prompt: "learn rust" });
  assert.equal(generated.statusCode, 200, generated.body);
  const { firstCourseSlug } = out(generated);
  const course = out(await t.q("courses.get", { slug: firstCourseSlug }));
  const lastLesson = (course.lessons as { slug: string }[]).at(-1)!;

  env.AI_KILL_SWITCH = true;
  assert.equal(code(await t.q("lessons.get", { id: lastLesson.slug })), "PRECONDITION_FAILED");
  assert.equal(lessonCalls, 0);
});
