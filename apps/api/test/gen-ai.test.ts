import { out, signUp, trpc } from "./helpers.ts";
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { lessons, lessonVersions, worlds } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { ensureLesson, idle } from "../src/ai/service.ts";
import { setModerationClient } from "../src/safety/moderation.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import lesson1 from "../../web/src/player/fixtures/lesson1.ts";

const realLesson = generator.lesson; // later tests replace it; this one wants the engine-backed method
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
  env.ENGINE_TOKEN = "t".repeat(32);
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
  return { t, lesson: row!, learnerId: learner.id };
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

test("an engine part reserves four calls' worth of spend", async () => {
  const { lesson, learnerId } = await firstLesson();
  env.AI_CALL_ESTIMATE_USD = 0.5;
  env.AI_DAILY_BUDGET_USD = 0;
  env.AI_MONTHLY_BUDGET_USD = 0;
  await db.execute(sql`DELETE FROM spend_ledger`);
  engineParts.lesson = async () => ({ kind: "learn", body: "Variables hold values." });
  assert.equal(await ensureLesson(lesson.id, learnerId), true);
  const { rows: [r] } = await db.execute<{ s: string }>(sql`SELECT COALESCE(sum(amount_usd), 0)::text AS s FROM spend_ledger`);
  assert.equal(Number(r!.s), 2);
});

test("a predict reply reserves two calls' worth of spend on each attempt", async () => {
  const { lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ kind: "predict" }).where(eq(lessons.id, lesson.id));
  env.AI_CALL_ESTIMATE_USD = 0.5;
  env.AI_DAILY_BUDGET_USD = 0;
  env.AI_MONTHLY_BUDGET_USD = 0;
  await db.execute(sql`DELETE FROM spend_ledger`);
  generator.lesson = async () => {
    throw new Error("stop"); // fails both attempts; each attempt is reserved before the call
  };
  await assert.rejects(ensureLesson(lesson.id, learnerId));
  const { rows: [r] } = await db.execute<{ s: string }>(sql`SELECT COALESCE(sum(amount_usd), 0)::text AS s FROM spend_ledger`);
  assert.equal(Number(r!.s), 2); // two attempts x (reply + repair) x 0.5
});

test("a predict lesson stored for everyone is generated without the learner's missed concepts", async () => {
  const { lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ kind: "predict" }).where(eq(lessons.id, lesson.id));
  // A real missed concept in this learner's history: the old lessonContext would have sent it to the generator.
  const { rows: [step] } = await db.execute<{ id: string }>(sql`SELECT id FROM steps LIMIT 1`);
  assert.ok(step, "the seed should provide a step to attach an attempt to");
  await db.execute(sql`INSERT INTO attempts (id, learner_id, step_id, kind, observed, correct, missed_concepts)
    VALUES (gen_random_uuid()::text, ${learnerId}, ${step.id}, 'mcq', true, false, ARRAY['secret-concept'])`);
  const { rows: [has] } = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM attempts
    WHERE learner_id = ${learnerId} AND 'secret-concept' = ANY(missed_concepts)`);
  assert.equal(has!.n, 1);
  let seen: any;
  generator.lesson = async (ctx) => {
    seen = ctx;
    throw new Error("stop");
  };
  await assert.rejects(ensureLesson(lesson.id, learnerId));
  assert.deepEqual(seen.missedConcepts, []);
});

test("moderation down: a lesson in a public course is refused, a private one still generates", async () => {
  const safe = async () => ({ flagged: false, scores: { hate: 0, harassment: 0, "self-harm": 0, sexual: 0, violence: 0, illicit: 0, jailbreak: 0 } });
  const { lesson, learnerId } = await firstLesson();
  engineParts.lesson = async () => ({ kind: "learn", body: "Variables hold values." });
  setModerationClient(async () => {
    throw new Error("moderation unavailable");
  });
  try {
    // Published: everyone can read what gets saved, so an unchecked lesson must not be written.
    await db.update(worlds).set({ visibility: "public" }).where(eq(worlds.id, lesson.worldId));
    await assert.rejects(ensureLesson(lesson.id, learnerId));
    assert.equal((await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id))).length, 0);

    // Private: generation keeps failing open, as before.
    await db.update(worlds).set({ visibility: "private" }).where(eq(worlds.id, lesson.worldId));
    assert.equal(await ensureLesson(lesson.id, learnerId), true);
  } finally {
    setModerationClient(safe);
  }
});

test("a predict lesson comes from the engine over HTTP and the learner never sees an answer key", async () => {
  const { t, lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ kind: "predict" }).where(eq(lessons.id, lesson.id));
  const input = lesson1.steps[0]!.input;
  const step = (n: number) => ({
    title: `Step ${n}`,
    prompt: "What changes?",
    kind: "mcq",
    options: ["a", "b", "c", "d"],
    answer: 2,
    beforeFiles: input.beforeFiles,
    hunks: input.hunks,
    hints: [{ text: "Look at the new line." }],
    explanations: { workedExample: "It adds a line.", practice: "Add another." },
    concepts: ["ownership"],
  });
  const seen: { path?: string; token?: unknown; kind?: string } = {};
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      Object.assign(seen, { path: req.url, token: req.headers["x-engine-token"], kind: JSON.parse(raw).lesson.kind });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ lesson: { steps: [step(1), step(2), step(3)] } }));
    });
  }).listen(0);
  const savedUrl = env.ENGINE_URL;
  env.ENGINE_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  generator.lesson = realLesson;
  try {
    assert.equal(await ensureLesson(lesson.id, learnerId), true);
  } finally {
    env.ENGINE_URL = savedUrl;
    srv.close();
  }
  assert.deepEqual(seen, { path: "/v1/pipeline/lesson", token: env.ENGINE_TOKEN, kind: "predict" });
  const res = await t.q("lessons.get", { id: lesson.slug });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(out(res).steps.length, 3);
  assert.doesNotMatch(res.body, /"(answer|accepted|expectedOutput)"/);
});
