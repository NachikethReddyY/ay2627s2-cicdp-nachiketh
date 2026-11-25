import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { code, out, readSteps, signUp, trpc } from "./helpers.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { attempts, learners, lessons, lessonVersions, partCompletions, stepProgress, steps, user, worlds, type PartSecret } from "../src/db/schema.ts";
import { engineLearner } from "../src/engine-client/learner.ts";
import { idleMastery } from "../src/progress/mastery.ts";
import { env } from "../src/env.ts";

const app = buildApp();
after(() => app.close());

test("a read check returns its verdict while mastery processing is still waiting", async () => {
  const api = trpc(app, await signUp(app));
  const { checks } = await addLesson("learn", 2);
  const originalUpdate = engineLearner.update;
  const originalNext = engineLearner.next;
  let release = () => {};
  let started = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const called = new Promise<void>((resolve) => { started = resolve; });
  engineLearner.update = async (req) => {
    started();
    await blocked;
    return req.priors.map((prior) => ({ conceptId: prior.conceptId, pPosterior: 0.5, pNext: 0.5 }));
  };
  engineLearner.next = async () => ({ policyVersion: "test", action: "done", lessonId: null, conceptId: null, reasonCode: "DONE", reason: "Done" });
  try {
    const response = await Promise.race([
      api.m("steps.attempt", { id: checks[0]!.id, answer: { kind: "mcq", choice: 0 } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("verdict waited for mastery")), 2_000)),
    ]);
    assert.equal(out(response).correct, true);
    await called;
    const [record] = await db.select().from(attempts).where(eq(attempts.stepId, checks[0]!.id));
    assert.equal(record?.masteryAppliedAt, null);
    release();
    await idleMastery();
    const [applied] = await db.select().from(attempts).where(eq(attempts.stepId, checks[0]!.id));
    assert.ok(applied?.masteryAppliedAt);
  } finally {
    release();
    await idleMastery();
    engineLearner.update = originalUpdate;
    engineLearner.next = originalNext;
  }
});

test("AI help requires a wrong answer and never returns the answer key", async () => {
  const api = trpc(app, await signUp(app));
  const { checks } = await addLesson("learn", 2);
  const id = checks[0]!.id;
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ guide: { message: "The answer is READ_ANSWER_OPTION_PRIVATE", widgets: [] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const old = { url: env.ENGINE_URL, token: env.ENGINE_TOKEN, update: engineLearner.update, next: engineLearner.next };
  env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  env.ENGINE_TOKEN = "t".repeat(32);
  engineLearner.update = async (req) => req.priors.map((p) => ({ conceptId: p.conceptId, pPosterior: 0.5, pNext: 0.5 }));
  engineLearner.next = async () => ({ policyVersion: "test", action: "done", lessonId: null, conceptId: null, reasonCode: "DONE", reason: "Done" });
  try {
    assert.equal(code(await api.m("steps.aiHint", { id })), "FORBIDDEN");
    assert.equal(calls, 0);
    assert.equal(out(await api.m("steps.attempt", { id, answer: { kind: "mcq", choice: 1 } })).correct, false);
    assert.equal(calls, 0);
    const hint = await api.m("steps.aiHint", { id });
    assert.equal(hint.statusCode, 200, hint.body);
    assert.doesNotMatch(hint.body, /READ_ANSWER_OPTION_PRIVATE/);
    assert.equal(calls, 1);
    assert.equal(out(await api.m("steps.attempt", { id, answer: { kind: "mcq", choice: 0 } })).correct, true);
    assert.equal(code(await api.m("steps.aiHint", { id })), "FORBIDDEN");
    assert.equal(calls, 1);
  } finally {
    await idleMastery();
    env.ENGINE_URL = old.url;
    env.ENGINE_TOKEN = old.token;
    engineLearner.update = old.update;
    engineLearner.next = old.next;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

async function addLesson(kind: "learn" | "watch", count: number, intro?: string) {
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [lesson] = await db.insert(lessons).values({ slug: `${kind}-${count}`, title: "Read", worldId: world!.id, sourceKind: "authored", kind, status: "published" }).returning();
  const content: PartSecret = kind === "learn" ? { kind, intro, body: "PRIVATE_READ_CONTENT" } : { kind, beforeFiles: { "main.js": "before" }, hunks: [{ id: "h", file: "main.js", oldStart: 1, lines: ["+PRIVATE_READ_CONTENT"] }] };
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  const checks = count ? await db.insert(steps).values(readSteps.slice(0, count).map((s, idx) => ({
    lessonVersionId: version!.id, idx,
    public: { title: s.title, prompt: s.prompt, kind: s.kind, options: s.options },
    secret: { beforeFiles: s.beforeFiles, hunks: s.hunks, answer: s.answer, hints: s.hints, explanations: s.explanations, concepts: s.concepts },
  }))).returning() : [];
  return { lesson: lesson!, checks };
}

for (const kind of ["learn", "watch"] as const) {
  test(`${kind} content requires an opening prediction and at least two checks`, async () => {
    const cookie = await signUp(app);
    const api = trpc(app, cookie);
    for (const count of [0, 1, 2]) {
      const intro = kind === "learn" && count === 2 ? "Here's a small program that collects cart totals." : undefined;
      const { checks } = await addLesson(kind, count, intro);
      const get = async () => out(await api.q("lessons.get", { id: `${kind}-${count}` }));
      const before = await get();
      assert.equal(before.learnIntro, intro);
      assert.equal(before.part, null);
      assert.deepEqual(before.media, []);
      assert.equal(before.steps.length, count);
      assert.equal(code(await api.m("parts.complete", { lessonId: `${kind}-${count}` })), "FORBIDDEN");
      if (count === 2) {
        assert.equal(code(await api.q("steps.get", { id: checks[1]!.id })), "CONFLICT");
        assert.equal(code(await api.m("steps.hint", { id: checks[1]!.id })), "CONFLICT");
      }
      if (count) {
        assert.equal((await api.m("steps.attempt", { id: checks[0]!.id, answer: { kind: "mcq", choice: 1 } })).statusCode, 200);
        const afterPrediction = await get();
        assert.equal(afterPrediction.part !== null, count === 2);
        if (count === 1) {
          assert.deepEqual(afterPrediction.media, []);
          assert.equal(afterPrediction.completed, false);
        }
      }
    }
  });

  test(`${kind} legacy completions remain accessible`, async () => {
    const cookie = await signUp(app);
    out(await trpc(app, cookie).q("home.get"));
    const [learner] = await db.select({ id: learners.id }).from(learners).innerJoin(user, eq(user.id, learners.userId)).where(eq(user.email, "a@example.com"));
    for (const count of [0, 1]) {
      const { lesson } = await addLesson(kind, count);
      await db.insert(partCompletions).values({ learnerId: learner!.id, lessonId: lesson.id });
      const result = out(await trpc(app, cookie).q("lessons.get", { id: `${kind}-${count}` }));
      assert.equal(result.completed, true);
      assert.equal(result.part.kind, kind);
    }
  });

  test(`${kind} legacy skipped checks resume without erasing their history`, async () => {
    const api = trpc(app, await signUp(app));
    out(await api.q("home.get"));
    const [learner] = await db.select({ id: learners.id }).from(learners).innerJoin(user, eq(user.id, learners.userId)).where(eq(user.email, "a@example.com"));
    const { checks } = await addLesson(kind, 2);
    const [opening, closing] = checks;
    const learnerId = learner.id;
    await db.insert(stepProgress).values(checks.map((check) => ({ learnerId, stepId: check.id, state: "skipped" as const, attemptAllowed: false })));
    const skipped = await db.insert(attempts).values(checks.map((check) => ({ learnerId, stepId: check.id, kind: "skip" as const, observed: true }))).returning();

    const get = async () => out(await api.q("lessons.get", { id: `${kind}-2` }));
    const before = await get();
    assert.equal(before.part, null);
    assert.deepEqual(before.steps.map((step: { state: string }) => step.state), ["predicting", "predicting"]);
    assert.equal(code(await api.q("steps.get", { id: closing.id })), "CONFLICT");
    assert.equal(out(await api.q("steps.get", { id: opening.id })).attemptAllowed, true);

    const answer = { kind: "mcq", choice: 1 };
    out(await api.m("steps.attempt", { id: opening.id, answer }));
    assert.equal((await get()).part.kind, kind);
    assert.equal(out(await api.q("steps.get", { id: closing.id })).attemptAllowed, true);
    out(await api.m("steps.attempt", { id: closing.id, answer }));
    assert.equal((await get()).completed, true);
    for (const snapshot of skipped) {
      assert.deepEqual(await db.select().from(attempts).where(eq(attempts.id, snapshot.id)), [snapshot]);
    }
  });
}
