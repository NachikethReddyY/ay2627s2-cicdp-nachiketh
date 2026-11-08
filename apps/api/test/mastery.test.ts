import { code, out, signUp, trpc } from "./helpers.ts";
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { attempts, concepts, learners, mastery, recommendations, stepProgress, steps, worlds } from "../src/db/schema.ts";
import { EngineError } from "../src/engine-client/client.ts";
import { engineLearner } from "../src/engine-client/learner.ts";
import { applyObservations, observationOf, type AttemptFacts } from "../src/progress/mastery.ts";

const app = buildApp();
after(() => app.close());

const real = { update: engineLearner.update, next: engineLearner.next };
let updateCalls = 0;
const stubUpdate: typeof engineLearner.update = async (req) => {
  updateCalls++;
  return req.priors.map((p) => {
    const prior = p.pKnown ?? 0.2;
    const pNext = req.correct ? Math.min(0.99, prior + 0.3) : prior * 0.5;
    return { conceptId: p.conceptId, pPosterior: pNext, pNext };
  });
};
beforeEach(() => {
  updateCalls = 0;
  engineLearner.update = stubUpdate;
  engineLearner.next = async (req) => {
    const lesson = req.lessons.find((l) => !l.done) ?? null;
    return {
      action: lesson ? "practice" : "done",
      lessonId: lesson?.lessonId ?? null,
      conceptId: req.mastery[0]?.conceptId ?? null,
      reasonCode: "stub",
      reason: "Stub reason.",
    };
  };
});
afterEach(() => Object.assign(engineLearner, real));

const attempt = (c: string, choice: number, id = "s1") =>
  trpc(app, c).m("steps.attempt", { id, answer: { kind: "mcq", choice } });
const learnerId = async () => (await db.select().from(learners).limit(1))[0]!.id;
const pOf = async (slug: string) => {
  const [row] = await db
    .select({ p: mastery.pKnown, n: mastery.nObs })
    .from(mastery)
    .innerJoin(concepts, eq(concepts.id, mastery.conceptId))
    .where(eq(concepts.slug, slug));
  return row;
};
// s1's right answer is index 1.

test("observationOf maps the first action only", () => {
  const f = (o: Partial<AttemptFacts>): AttemptFacts => ({ observed: true, kind: "mcq", correct: true, hintsUsed: 0, ...o });
  const rows: [Partial<AttemptFacts>, string | null][] = [
    [{}, "correct"],
    [{ kind: "cloze" }, "correct"],
    [{ hintsUsed: 1 }, "incorrect"],
    [{ correct: false }, "incorrect"],
    [{ correct: false, hintsUsed: 2 }, "incorrect"],
    [{ kind: "skip", correct: null }, "incorrect"],
    [{ observed: false }, null],
    [{ observed: false, correct: false }, null],
    [{ observed: false, kind: "skip", correct: null }, null],
  ];
  for (const [o, want] of rows) assert.equal(observationOf(f(o)), want, JSON.stringify(o));
});

test("a clean correct answer raises p_known and stores a recommendation", async () => {
  const c = await signUp(app);
  assert.equal((await attempt(c, 1)).statusCode, 200);
  const m = await pOf("functions");
  assert.equal(m?.n, 1);
  assert.ok(m!.p > 0.2);
  assert.ok(await pOf("array reduce"));
  const recs = await db.select().from(recommendations);
  assert.equal(recs.length, 1);
  assert.ok(recs[0]!.reason.length > 0);
});

test("a hint-assisted correct answer lowers p_known", async () => {
  const c = await signUp(app);
  assert.equal((await trpc(app, c).m("steps.hint", { id: "s1" })).statusCode, 200);
  assert.equal((await attempt(c, 1)).statusCode, 200);
  const m = await pOf("functions");
  assert.equal(m?.n, 1);
  assert.ok(m!.p < 0.2);
});

test("a skipped first action counts as incorrect", async () => {
  const c = await signUp(app);
  assert.equal((await trpc(app, c).m("steps.skip", { id: "s1" })).statusCode, 200);
  const m = await pOf("functions");
  assert.equal(m?.n, 1);
  assert.ok(m!.p < 0.2);
});

test("the second attempt on a step is not observed", async () => {
  const c = await signUp(app);
  await attempt(c, 0); // wrong, observed
  await trpc(app, c).m("steps.hint", { id: "s1" });
  assert.equal(out(await attempt(c, 1)).correct, true);
  const rows = await db.select().from(attempts);
  assert.deepEqual(rows.map((r) => r.observed).sort(), [false, true]);
  assert.equal((await pOf("functions"))?.n, 1);
  assert.equal(updateCalls, 1);
});

test("applying twice does not double n_obs", async () => {
  const c = await signUp(app);
  await attempt(c, 1);
  const id = await learnerId();
  await applyObservations(id);
  await applyObservations(id);
  assert.equal((await pOf("functions"))?.n, 1);
  assert.equal(updateCalls, 1);
});

test("an engine failure never fails the attempt, and a later read catches up", async () => {
  const c = await signUp(app);
  engineLearner.update = async () => {
    throw new EngineError("engine down", 503, null);
  };
  assert.equal((await attempt(c, 1)).statusCode, 200);
  assert.equal((await db.select().from(mastery)).length, 0);
  const [a] = await db.select().from(attempts);
  assert.equal(a!.masteryAppliedAt, null);

  engineLearner.update = stubUpdate;
  const list = out(await trpc(app, c).q("me.mastery", { world: "codequest" }));
  assert.equal(list.length, 2);
  assert.equal(list[0].nObs, 1);
});

test("invalid bkt config is ignored and observations still apply with defaults", async () => {
  const c = await signUp(app);
  await db.execute(sql`UPDATE worlds SET config = '{"bkt":{"pSlip":0.9,"pGuess":0.1,"pLearn":0.3,"pInit":0.2}}'::jsonb`);
  const seen: unknown[] = [];
  engineLearner.update = async (req) => {
    seen.push(req.params);
    return stubUpdate(req);
  };
  assert.equal((await attempt(c, 1)).statusCode, 200);
  assert.deepEqual(seen, [undefined]);
  assert.equal((await pOf("functions"))?.n, 1);
});

test("a row the engine rejects, or with a bad concept entry, does not block a later valid one", async () => {
  const c = await signUp(app);
  await db.update(steps).set({ secret: sql`jsonb_set(secret, '{concepts}', '[123, null, "  Loops "]')` }).where(eq(steps.id, "s1"));
  await attempt(c, 1);
  assert.ok(await pOf("loops"));
  assert.equal((await pOf("loops"))?.n, 1);

  // A permanent engine rejection on s2 is skipped and marked; it does not stall the learner.
  engineLearner.update = async () => {
    throw new EngineError("Engine answered 422", 422, null);
  };
  await attempt(c, 0, "s2");
  assert.ok((await db.select().from(attempts)).every((a) => a.masteryAppliedAt));
  assert.equal((await pOf("loops"))?.n, 1);
});

test("20 parallel attempts give n_obs = 1", async () => {
  const c = await signUp(app);
  const results = await Promise.all(Array.from({ length: 20 }, () => attempt(c, 1)));
  assert.ok(results.some((r) => r.statusCode === 200));
  assert.equal((await db.select().from(attempts)).filter((a) => a.observed).length, 1);
  assert.equal((await pOf("functions"))?.n, 1);
  assert.equal(updateCalls, 1);
});

test("steps with their own concepts use them, and a step with none makes no observation", async () => {
  const c = await signUp(app);
  await db.update(steps).set({ secret: sql`jsonb_set(secret, '{concepts}', '["  Loops "]')` }).where(eq(steps.id, "s1"));
  await attempt(c, 1);
  assert.ok(await pOf("loops"));
  assert.equal(await pOf("functions"), undefined);

  await db.execute(sql`UPDATE lessons SET concepts = '{}'`);
  await db.update(steps).set({ secret: sql`secret - 'concepts'` }).where(eq(steps.id, "s2"));
  const before = updateCalls;
  await attempt(c, 0, "s2");
  assert.equal(updateCalls, before);
  const done = await db.select().from(attempts);
  assert.ok(done.every((a) => a.masteryAppliedAt));
});

test("me.mastery and me.next require a session", async () => {
  const t = trpc(app);
  assert.equal((await t.q("me.mastery", { world: "codequest" })).statusCode, 401);
  assert.equal((await t.q("me.next", { world: "codequest" })).statusCode, 401);
  assert.equal(code(await t.q("me.next", { world: "codequest" })), "UNAUTHORIZED");
});

test("a private course is not found", async () => {
  const c = await signUp(app);
  await db.update(worlds).set({ visibility: "private" }).where(eq(worlds.slug, "codequest"));
  for (const p of ["me.mastery", "me.next"]) {
    const res = await trpc(app, c).q(p, { world: "codequest" });
    assert.equal(res.statusCode, 404, p);
    assert.equal(code(res), "NOT_FOUND");
  }
});

test("me.next carries a reason, even before any attempt", async () => {
  const c = await signUp(app);
  const first = out(await trpc(app, c).q("me.next", { world: "codequest" }));
  assert.ok(first.reason.length > 0);
  assert.equal(first.lessonSlug, "lesson-1");
  await attempt(c, 1);
  const next = out(await trpc(app, c).q("me.next", { world: "codequest" }));
  assert.ok(next.reason.length > 0);
  assert.equal(next.action, "practice");
  assert.ok(next.conceptSlug);
});

test("me.mastery and me.next leak no answer keys, hints or explanations", async () => {
  const c = await signUp(app);
  await attempt(c, 1);
  const t = trpc(app, c);
  const bodies = [(await t.q("me.mastery", { world: "codequest" })).body, (await t.q("me.next", { world: "codequest" })).body];
  const secrets: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "string" && v.length > 3) secrets.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  for (const s of await db.select({ secret: steps.secret }).from(steps)) {
    const { hints, explanations, answer, accepted } = s.secret;
    collect([hints.map((h) => h.text), explanations, answer, accepted]);
  }
  assert.ok(secrets.length > 5);
  for (const body of bodies) {
    for (const key of ["secret", "answer", "accepted", "hunks", "hints", "explanations", "expectedOutput", "workedExample"]) {
      assert.ok(!body.includes(`"${key}"`), `leaked key ${key}`);
    }
    for (const s of secrets) assert.ok(!body.includes(JSON.stringify(s).slice(1, -1)), `leaked ${s.slice(0, 30)}`);
  }
});

test("deleting a learner cascades to mastery and recommendations", async () => {
  const c = await signUp(app);
  await attempt(c, 1);
  assert.equal((await db.select().from(mastery)).length, 2);
  assert.equal((await db.select().from(recommendations)).length, 1);
  const id = await learnerId();
  // Attempt history has no cascade of its own; clear it so the learner row can go.
  await db.delete(attempts).where(eq(attempts.learnerId, id));
  await db.delete(stepProgress).where(eq(stepProgress.learnerId, id));
  await db.delete(learners).where(eq(learners.id, id));
  assert.equal((await db.select().from(mastery)).length, 0);
  assert.equal((await db.select().from(recommendations)).length, 0);
});
