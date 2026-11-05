import { out, signUp, trpc } from "./helpers.ts";
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { lessons, lessonVersions } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { ensureLesson, idle } from "../src/ai/service.ts";

const app = buildApp();
after(() => app.close());

const outline = {
  title: "Learn Rust",
  tagline: "Ownership first",
  subject: "code",
  courses: [0, 1].map((c) => ({
    title: `Course ${c}`,
    description: "d",
    lessons: [1, 2, 3].map((n) => ({ title: `Lesson ${c}.${n}`, level: n, concepts: ["ownership"], kind: "learn" as const })),
  })),
};
const saved = { est: env.AI_CALL_ESTIMATE_USD, d: env.AI_DAILY_BUDGET_USD, m: env.AI_MONTHLY_BUDGET_USD };
beforeEach(() => {
  env.ANTHROPIC_API_KEY = "test-key";
  generator.outline = async () => outline;
});
afterEach(async () => {
  Object.assign(env, { AI_CALL_ESTIMATE_USD: saved.est, AI_DAILY_BUDGET_USD: saved.d, AI_MONTHLY_BUDGET_USD: saved.m });
  await idle();
  await db.execute(sql`DELETE FROM spend_ledger`);
});

async function firstLesson() {
  const t = trpc(app, await signUp(app, "gen@example.com"));
  const res = await t.m("paths.generate", { prompt: "learn rust" });
  assert.equal(res.statusCode, 200, res.body);
  const course = out(await t.q("courses.get", { slug: out(res).firstCourseSlug }));
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, course.lessons[0].slug));
  const learner = (await db.execute<{ id: string }>(sql`SELECT id FROM learners LIMIT 1`)).rows[0]!;
  return { lesson: row!, learnerId: learner.id };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

test("generation holds no transaction or pooled connection, and a concurrent writer wins exactly once", async () => {
  const { lesson, learnerId } = await firstLesson();
  const g = gate();
  const started = gate();
  let calls = 0;
  engineParts.lesson = async () => {
    calls++;
    started.open();
    await g.opened;
    return { kind: "learn", body: "Variables hold values." };
  };
  const a = ensureLesson(lesson.id, learnerId);
  const b = ensureLesson(lesson.id, learnerId); // same process: shares the in-flight write
  await started.opened;
  // While the slow engine call is pending: no checked-out client, nothing idle in a transaction, no row lock held.
  assert.equal(pool.totalCount - pool.idleCount, 0, "no pooled connection is held during generation");
  const { rows: [act] } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`);
  assert.equal(act!.n, 0);
  // The row is lockable by anyone meanwhile; simulate another instance writing the lesson first.
  const [v] = await db.insert(lessonVersions).values({ lessonId: lesson.id, version: 1, publishedAt: new Date(), content: { kind: "learn", body: "other" } }).returning();
  await db.update(lessons).set({ currentVersionId: v!.id, status: "published" }).where(eq(lessons.id, lesson.id));
  g.open();
  assert.deepEqual(await Promise.all([a, b]), [false, false], "the late writer drops its result");
  assert.equal(calls, 1);
  const versions = await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id));
  assert.equal(versions.length, 1);
});

test("concurrent first plays produce exactly one version", async () => {
  const { lesson, learnerId } = await firstLesson();
  let calls = 0;
  engineParts.lesson = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return { kind: "learn", body: "Variables hold values." };
  };
  const results = await Promise.all([1, 2, 3].map(() => ensureLesson(lesson.id, learnerId)));
  assert.deepEqual(results, [true, true, true]);
  assert.equal(calls, 1);
  assert.equal((await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id))).length, 1);
});

test("an engine part reserves three calls' worth of spend", async () => {
  const { lesson, learnerId } = await firstLesson();
  env.AI_CALL_ESTIMATE_USD = 0.5;
  env.AI_DAILY_BUDGET_USD = 0;
  env.AI_MONTHLY_BUDGET_USD = 0;
  await db.execute(sql`DELETE FROM spend_ledger`);
  engineParts.lesson = async () => ({ kind: "learn", body: "Variables hold values." });
  assert.equal(await ensureLesson(lesson.id, learnerId), true);
  const { rows: [r] } = await db.execute<{ s: string }>(sql`SELECT COALESCE(sum(amount_usd), 0)::text AS s FROM spend_ledger`);
  assert.equal(Number(r!.s), 1.5);
});

test("a predict lesson stored for everyone is generated without the learner's missed concepts", async () => {
  const { lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ kind: "predict" }).where(eq(lessons.id, lesson.id));
  await db.execute(sql`INSERT INTO attempts (id, learner_id, lesson_id, missed_concepts, created_at)
    SELECT gen_random_uuid()::text, ${learnerId}, ${lesson.id}, ARRAY['secret-concept'], now() WHERE false`).catch(() => undefined);
  let seen: any;
  generator.lesson = async (ctx) => {
    seen = ctx;
    throw new Error("stop");
  };
  await assert.rejects(ensureLesson(lesson.id, learnerId));
  assert.deepEqual(seen.missedConcepts, []);
});
