import { code, out, signUp, trpc, withChecks } from "./helpers.ts";
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNull, sql } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { concepts, learners, lessons, lessonVersions, mastery, user, worlds } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator, type LearnerMemory } from "../src/ai/generator.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { ensureLesson, idle } from "../src/ai/service.ts";
import type { GeneratedMcqStep } from "../src/ai/step-schema.ts";
import { setModerationClient } from "../src/safety/moderation.ts";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

const realLesson = generator.lesson;
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
const saved = { est: env.AI_CALL_ESTIMATE_USD, d: env.AI_DAILY_BUDGET_USD, m: env.AI_MONTHLY_BUDGET_USD };
beforeEach(() => {
  env.AI_WRITE_COURSE_ON_GENERATE = false;
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
  const { slug, firstCourseSlug } = out(res);
  const course = out(await t.q("courses.get", { slug: firstCourseSlug }));
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, course.lessons[0].slug));
  const learner = (await db.execute<{ id: string }>(sql`SELECT id FROM learners LIMIT 1`)).rows[0]!;
  return { t, slug, lesson: row!, learnerId: learner.id };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}

test("new path outlines receive bounded observed global focus from the signed-in learner", async () => {
  const mine = trpc(app, await signUp(app, "focus@example.com"));
  const other = trpc(app, await signUp(app, "other@example.com"));
  assert.equal((await mine.q("home.get")).statusCode, 200);
  assert.equal((await other.q("home.get")).statusCode, 200);
  const [owner] = await db.select({ id: learners.id }).from(learners).innerJoin(user, eq(user.id, learners.userId))
    .where(eq(user.email, "focus@example.com"));
  const [different] = await db.select({ id: learners.id }).from(learners).innerJoin(user, eq(user.id, learners.userId))
    .where(eq(user.email, "other@example.com"));
  const slugs = ["js.return-values", "js.functions", "js.conditionals", "js.loops", "js.arrays", "js.array-reduce", "js.values-types", "js.variables"];
  await db.insert(concepts).values(slugs.map((slug) => ({ slug, name: slug }))).onConflictDoNothing();
  const globalIds = new Map((await db.select().from(concepts).where(isNull(concepts.worldId))).map((row) => [row.slug, row.id]));
  const [world] = await db.select({ id: worlds.id }).from(worlds).where(eq(worlds.slug, "variables"));
  const [custom] = await db.insert(concepts).values({ worldId: world.id, slug: "local-only", name: "Local only" }).returning();
  const [extra] = await db.insert(concepts).values({ slug: "not-canonical", name: "Not canonical" }).returning();
  await db.insert(mastery).values([
    ...slugs.map((slug, index) => ({ learnerId: owner.id, conceptId: globalIds.get(slug)!, pKnown: (index + 1) / 10, nObs: slug === "js.loops" ? 0 : 1 })),
    { learnerId: owner.id, conceptId: custom.id, pKnown: 0.01, nObs: 1 },
    { learnerId: owner.id, conceptId: extra.id, pKnown: 0.01, nObs: 1 },
    { learnerId: different.id, conceptId: globalIds.get("js.variables")!, pKnown: 0.01, nObs: 1 },
  ]);

  const calls: { topic: string; learnerMemory: LearnerMemory }[] = [];
  generator.outline = async (topic, learnerMemory) => {
    calls.push({ topic, learnerMemory });
    return outline;
  };
  const first = await mine.m("paths.generate", { prompt: "learn JavaScript" });
  assert.equal(first.statusCode, 200, first.body);
  await db.update(mastery).set({ nObs: 1 }).where(and(eq(mastery.learnerId, owner.id), eq(mastery.conceptId, globalIds.get("js.loops")!)));
  const second = await mine.m("paths.generate", { prompt: "learn JavaScript" });
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(calls, [
    { topic: "learn JavaScript", learnerMemory: { focusConcepts: slugs.slice(0, 7).filter((slug) => slug !== "js.loops") } },
    { topic: "learn JavaScript", learnerMemory: { focusConcepts: slugs.slice(0, 6) } },
  ]);
});

test("generation holds no transaction or pooled connection, and a concurrent writer wins exactly once", async () => {
  const { lesson, learnerId } = await firstLesson();
  const g = gate();
  const started = gate();
  let calls = 0;
  engineParts.lesson = async () => {
    calls++;
    started.open();
    await g.opened;
    return withChecks({ kind: "learn", body: "Variables hold values." });
  };
  const a = ensureLesson(lesson.id, learnerId);
  const b = ensureLesson(lesson.id, learnerId);
  await started.opened;
  assert.equal(pool.totalCount - pool.idleCount, 0, "no pooled connection is held during generation");
  const { rows: [act] } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`);
  assert.equal(act!.n, 0);
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
    return withChecks({ kind: "learn", body: "Variables hold values." });
  };
  const results = await Promise.all([1, 2, 3].map(() => ensureLesson(lesson.id, learnerId)));
  assert.deepEqual(results, [true, true, true]);
  assert.equal(calls, 1);
  assert.equal((await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id))).length, 1);
});

test("an engine part reserves six calls' worth of spend", async () => {
  const { lesson, learnerId } = await firstLesson();
  env.AI_CALL_ESTIMATE_USD = 0.5;
  env.AI_DAILY_BUDGET_USD = 0;
  env.AI_MONTHLY_BUDGET_USD = 0;
  await db.execute(sql`DELETE FROM spend_ledger`);
  engineParts.lesson = async () => withChecks({ kind: "learn", body: "Variables hold values." });
  assert.equal(await ensureLesson(lesson.id, learnerId), true);
  const { rows: [r] } = await db.execute<{ s: string }>(sql`SELECT COALESCE(sum(amount_usd), 0)::text AS s FROM spend_ledger`);
  assert.equal(Number(r!.s), 3);
});

test("a predict reply reserves three calls' worth of spend on each attempt", async () => {
  const { lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ kind: "predict" }).where(eq(lessons.id, lesson.id));
  env.AI_CALL_ESTIMATE_USD = 0.5;
  env.AI_DAILY_BUDGET_USD = 0;
  env.AI_MONTHLY_BUDGET_USD = 0;
  await db.execute(sql`DELETE FROM spend_ledger`);
  generator.lesson = async () => {
    throw new Error("stop");
  };
  await assert.rejects(ensureLesson(lesson.id, learnerId));
  const { rows: [r] } = await db.execute<{ s: string }>(sql`SELECT COALESCE(sum(amount_usd), 0)::text AS s FROM spend_ledger`);
  assert.equal(Number(r!.s), 3);
});

test("a predict lesson stored for everyone is generated without the learner's missed concepts", async () => {
  const { lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ kind: "predict" }).where(eq(lessons.id, lesson.id));
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
  engineParts.lesson = async () => withChecks({ kind: "learn", body: "Variables hold values." });
  setModerationClient(async () => {
    throw new Error("moderation unavailable");
  });
  try {
    await db.update(worlds).set({ visibility: "public" }).where(eq(worlds.id, lesson.worldId));
    await assert.rejects(ensureLesson(lesson.id, learnerId));
    assert.equal((await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id))).length, 0);

    await db.update(worlds).set({ visibility: "private" }).where(eq(worlds.id, lesson.worldId));
    assert.equal(await ensureLesson(lesson.id, learnerId), true);
  } finally {
    setModerationClient(safe);
  }
});

test("a lesson generated while its path is published must pass public moderation", { timeout: 15_000 }, async () => {
  const { t, slug, lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ concepts: ["js.variables"] }).where(eq(lessons.id, lesson.id));
  const [variables] = await db.select({ id: concepts.id }).from(concepts).where(and(eq(concepts.slug, "js.variables"), isNull(concepts.worldId)));
  await db.insert(mastery).values({ learnerId, conceptId: variables.id, pKnown: 0.4, nObs: 1 });
  const started = gate();
  const release = gate();
  const draftBody = "Variables store values the learner can reuse.";
  const promptMisses: string[][] = [];
  const safe = async () => ({ flagged: false, scores: {} });
  let moderationCalls = 0;
  setModerationClient(async (input) => {
    if (input.includes(draftBody)) {
      moderationCalls++;
      throw new Error("moderation unavailable for the lesson body");
    }
    return safe();
  });
  engineParts.lesson = async (ctx) => {
    promptMisses.push(ctx.missedConcepts);
    started.open();
    await release.opened;
    return withChecks({ kind: "learn", body: draftBody });
  };

  const writing = ensureLesson(lesson.id, learnerId);
  const rejected = assert.rejects(writing, /Couldn't write this lesson/);
  try {
    await started.opened;
    const published = await t.m("paths.publish", { slug });
    assert.equal(published.statusCode, 200, published.body);
    release.open();
    await rejected;
    assert.equal(moderationCalls, 2);
    assert.deepEqual(promptMisses, [["js.variables"], []]);
    const [row] = await db.select().from(lessons).where(eq(lessons.id, lesson.id));
    assert.equal(row?.currentVersionId, null);
  } finally {
    release.open();
    await writing.catch(() => {});
    await rejected.catch(() => {});
    setModerationClient(safe);
  }
});

test("predict generation rejects an ambiguous union cloze and serves the repaired MCQ without an answer key", async () => {
  const { t, slug, lesson, learnerId } = await firstLesson();
  await db.update(lessons).set({ kind: "predict" }).where(eq(lessons.id, lesson.id));
  const clozeStep: Omit<GeneratedMcqStep, "kind" | "options" | "answer"> & {
    kind: "cloze";
    answer: string;
  } = JSON.parse(readFileSync(
    new URL("../../../services/engine/tests/fixtures/ambiguous_union_cloze.json", import.meta.url), "utf8",
  ));
  const question = "Which assignment leaves item holding a number?";
  const mcqStep: GeneratedMcqStep & { scenario: string } = {
    title: clozeStep.title,
    beforeFiles: clozeStep.beforeFiles,
    hints: clozeStep.hints,
    explanations: clozeStep.explanations,
    concepts: clozeStep.concepts,
    kind: "mcq",
    scenario: "Suppose item is reassigned to a numeric value instead of a string.",
    prompt: question,
    options: ['item = "42";', "item = 42;", "item = false;", "item === 42;"],
    answer: 1,
    hunks: [{ id: "assign", file: "main.ts", oldStart: 1, lines: [' let item: string | number = "tea";', "+item = 42;"] }],
  };
  const scenarios: { unrevealedLine: string; step: GeneratedMcqStep & { scenario: string } }[] = JSON.parse(readFileSync(
    new URL("../../../services/engine/tests/fixtures/predict_scenarios.json", import.meta.url), "utf8",
  ));
  const seen: { path?: string; token?: unknown; kind?: string } = {};
  let calls = 0;
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      Object.assign(seen, { path: req.url, token: req.headers["x-engine-token"], kind: JSON.parse(raw).lesson.kind });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ lesson: { steps: [calls++ === 0 ? { ...clozeStep, scenario: mcqStep.scenario } : mcqStep, ...scenarios.map(({ step }) => step)] } }));
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
  assert.equal(calls, 2, "a cloze from the engine must be rejected before persistence");
  assert.deepEqual(seen, { path: "/v1/pipeline/lesson", token: env.ENGINE_TOKEN, kind: "predict" });
  const res = await t.q("lessons.get", { id: lesson.slug });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(out(res).steps.length, 3);
  assert.doesNotMatch(res.body, /"(answer|accepted|expectedOutput)"/);

  const id = out(res).steps[0].id;
  const questionResponse = await t.q("steps.get", { id });
  assert.equal(questionResponse.statusCode, 200, questionResponse.body);
  assert.deepEqual(out(questionResponse).options, mcqStep.options);
  assert.doesNotMatch(questionResponse.body, /"(answer|accepted|hunks)"/);
  assert.equal((await t.q("steps.reveal", { id })).statusCode, 409);
  const attempt = await t.m("steps.attempt", { id, answer: { kind: "mcq", choice: 1 } });
  assert.equal(out(attempt).correct, true);
  assert.deepEqual(out(await t.q("steps.reveal", { id })).answer, { type: "mcq", index: 1 });

  for (const [i, { step, unrevealedLine }] of scenarios.entries()) {
    const id = out(res).steps[i + 1].id;
    const visible = await t.q("steps.get", { id });
    assert.equal(visible.statusCode, 200, visible.body);
    assert.equal(out(visible).prompt, `${step.scenario} ${step.prompt}`);
    assert.deepEqual(out(visible).beforeFiles, step.beforeFiles);
    assert.deepEqual(out(visible).options, step.options);
    assert.deepEqual(out(visible).hints, []);
    assert.doesNotMatch(visible.body, /"(answer|hunks|explanations)":/);
    assert.equal(visible.body.includes(unrevealedLine), false);
    assert.equal((await t.q("steps.reveal", { id })).statusCode, 409);
    assert.equal(out(await t.m("steps.attempt", { id, answer: { kind: "mcq", choice: step.answer } })).correct, true);
    assert.ok(out(await t.q("steps.reveal", { id })).hunks.some((hunk: { lines: string[] }) => hunk.lines.includes(`+${unrevealedLine}`)));
  }

  setModerationClient(async (text) => ({ flagged: text.includes(question), scores: {} }));
  try {
    assert.equal(code(await t.m("paths.publish", { slug })), "PRECONDITION_FAILED");
    const [world] = await db.select().from(worlds).where(eq(worlds.id, lesson.worldId));
    assert.equal(world?.visibility, "private");
  } finally {
    setModerationClient(async () => ({ flagged: false, scores: {} }));
  }
});

test("a generated course is one section: every lesson sits in level 1, whatever the model suggested", async () => {
  const t = trpc(app, await signUp(app, "one-section@example.com"));
  const res = await t.m("paths.generate", { prompt: "learn rust" });
  assert.equal(res.statusCode, 200, res.body);
  const course = out(await t.q("courses.get", { slug: out(res).firstCourseSlug }));
  assert.ok(course.lessons.length > 0);
  assert.deepEqual([...new Set(course.lessons.map((l: { level: number }) => l.level))], [1]);
});
