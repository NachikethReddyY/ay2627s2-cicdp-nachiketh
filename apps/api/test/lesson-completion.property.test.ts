import { out, signUp, trpc } from "./helpers.ts";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { attempts, gameCompletions, learners, lessons, lessonVersions, stepProgress, user, worlds, type PartSecret } from "../src/db/schema.ts";
import { seed } from "../src/db/seed.ts";
import { engineLearner } from "../src/engine-client/learner.ts";

const app = buildApp();
const real = { update: engineLearner.update, next: engineLearner.next };
engineLearner.update = async (req) => req.priors.map((p) => ({ conceptId: p.conceptId, pPosterior: p.pKnown ?? 0.2, pNext: p.pKnown ?? 0.2 }));
engineLearner.next = async () => ({ action: "done", lessonId: null, conceptId: null, reasonCode: "stub", reason: "Stub reason." });
after(() => {
  Object.assign(engineLearner, real);
  return app.close();
});

const RUN_ID = randomUUID().slice(0, 8);
const emailOf = (name: string) => `${name}-${RUN_ID}@example.com`;
let lessonCounter = 0;

const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const q = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).q(path, input);

const RUNS = 12;
const ACTIONS = 15;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const PREDICT_STEPS = [
  { id: "s1", right: { kind: "mcq", choice: 1 }, wrong: { kind: "mcq", choice: 0 } },
  { id: "s2", right: { kind: "cloze", text: "discount = 0" }, wrong: { kind: "cloze", text: "discount = 9" } },
  { id: "s3", right: { kind: "mcq", choice: 1 }, wrong: { kind: "mcq", choice: 0 } },
] as const;
type PredictStep = (typeof PREDICT_STEPS)[number];
const PREDICT_ACTIONS = ["right", "right", "right", "wrong", "hint", "skip"] as const;

const userIdOf = async (email: string) => (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;
const learnerOf = async (email: string) => (await db.select({ id: learners.id }).from(learners).where(eq(learners.userId, await userIdOf(email))))[0]!.id;

async function signedUp(email: string) {
  const cookie = await signUp(app, email);
  assert.equal((await q(cookie, "home.get")).statusCode, 200);
  return cookie;
}

async function predictAct(cookie: string, step: PredictStep, action: (typeof PREDICT_ACTIONS)[number]) {
  if (action === "hint") return m(cookie, "steps.hint", { id: step.id });
  if (action === "skip") return m(cookie, "steps.skip", { id: step.id });
  return m(cookie, "steps.attempt", { id: step.id, answer: step[action] });
}

async function codequestLesson(cookie: string, slug: string) {
  const res = await q(cookie, "courses.get", { slug: "codequest" });
  if (res.statusCode !== 200) throw new Error(res.body);
  const lesson = out(res).lessons.find((l: { slug: string }) => l.slug === slug);
  assert.ok(lesson, `${slug} is listed`);
  return lesson as { done: number; total: number };
}

test("a predict lesson completes only when every step is revealed from an observed answer", async () => {
  const rand = mulberry32(115);
  let completedRuns = 0;
  for (let run = 0; run < RUNS; run++) {
    const email = emailOf(`predict${run}`);
    const cookie = await signedUp(email);
    for (let i = 0; i < ACTIONS; i++) {
      const res = await predictAct(cookie, pick(rand, PREDICT_STEPS), pick(rand, PREDICT_ACTIONS));
      assert.ok(res.statusCode < 500, `run ${run} action ${i}: ${res.body}`);
      const learnerId = await learnerOf(email);

      const lesson = await codequestLesson(cookie, "lesson-1");
      const progress = await db.select().from(stepProgress).where(eq(stepProgress.learnerId, learnerId));
      const answered = new Set(
        (await db.select().from(attempts).where(and(eq(attempts.learnerId, learnerId), eq(attempts.observed, true))))
          .filter((a) => a.kind !== "skip")
          .map((a) => a.stepId),
      );
      const revealed = new Set(progress.filter((p) => p.state === "revealed").map((p) => p.stepId));
      const counted = [...revealed].filter((id) => answered.has(id)).length;
      assert.equal(lesson.done, counted, `run ${run} action ${i}: done counts only revealed steps with an observed answer`);

      if (lesson.done >= lesson.total) {
        completedRuns++;
        for (const step of PREDICT_STEPS) {
          assert.ok(answered.has(step.id) && revealed.has(step.id), `run ${run} action ${i}: ${step.id} completes the lesson without an observed answer`);
        }
      }
    }
  }
  assert.ok(completedRuns > 0, "the generated runs must reach completion at least once");
});

test("skipping a predict step is refused and never completes the lesson", async () => {
  const cookie = await signUp(app, emailOf("skipper"));
  for (const step of PREDICT_STEPS) {
    const res = await m(cookie, "steps.skip", { id: step.id });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /cannot be skipped/);
  }
  assert.equal((await codequestLesson(cookie, "lesson-1")).done, 0);
  assert.equal((await db.select().from(attempts).where(eq(attempts.learnerId, await learnerOf(emailOf("skipper"))))).length, 0);
  for (const step of PREDICT_STEPS) assert.equal((await m(cookie, "steps.attempt", { id: step.id, answer: step.right })).statusCode, 200);
  const lesson = await codequestLesson(cookie, "lesson-1");
  assert.deepEqual([lesson.done, lesson.total], [3, 3]);
});

const quizBlock = (id: string) => ({
  type: "game",
  id,
  props: { title: id, goalText: "Win.", alt: "A quiz.", hints: [], shell: {}, kind: { kind: "quiz", questions: [{ prompt: "2 + 2?", options: ["3", "4"], answer: 1 }] } },
});

type GameLesson = { slug: string; lessonId: string };

const gameContent = (blocks: unknown[]): PartSecret => ({ kind: "game-practice", intro: "Play.", doc: { v: 1, blocks } as never });

async function addGameLesson(blocks: unknown[]): Promise<GameLesson> {
  await seed();
  const slug = `games-${RUN_ID}-${lessonCounter++}`;
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [lesson] = await db.insert(lessons).values({ slug, title: "Games", worldId: world!.id, sourceKind: "authored", kind: "game-practice", status: "published" }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content: gameContent(blocks) }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  return { slug, lessonId: lesson!.id };
}

async function publishVersion(lesson: GameLesson, version: number, blocks: unknown[]) {
  const [row] = await db.insert(lessonVersions).values({ lessonId: lesson.lessonId, version, content: gameContent(blocks) }).returning();
  await db.update(lessons).set({ currentVersionId: row!.id }).where(eq(lessons.id, lesson.lessonId));
}

const addTwoGameLesson = () => addGameLesson([quizBlock("g1"), quizBlock("g2")]);

const play = (cookie: string, lesson: GameLesson, gameIndex: number, right: boolean) =>
  m(cookie, "games.check", { lessonId: lesson.slug, gameIndex, submission: { kind: "quiz", answers: [right ? 1 : 0] } });

const progressOf = async (cookie: string, lesson: GameLesson) => {
  const { done, total } = await codequestLesson(cookie, lesson.slug);
  return [done, total];
};

test("winning one of two games does not complete a game lesson", async () => {
  const lesson = await addTwoGameLesson();
  const cookie = await signUp(app, emailOf("one-of-two"));
  assert.equal(out(await play(cookie, lesson, 0, true)).complete, true);
  assert.equal(out(await play(cookie, lesson, 0, true)).complete, true);
  assert.equal((await codequestLesson(cookie, lesson.slug)).done, 0);
  assert.equal(out(await play(cookie, lesson, 1, false)).complete, false);
  assert.equal((await codequestLesson(cookie, lesson.slug)).done, 0);
  assert.equal(out(await play(cookie, lesson, 1, true)).complete, true);
  assert.equal((await codequestLesson(cookie, lesson.slug)).done, 1);
});

test("a block added in a new version reopens a completed game lesson until it is won", async () => {
  const lesson = await addTwoGameLesson();
  const cookie = await signUp(app, emailOf("added"));
  await play(cookie, lesson, 0, true);
  await play(cookie, lesson, 1, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);

  await publishVersion(lesson, 2, [quizBlock("g1"), quizBlock("g2"), quizBlock("g3")]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1], "wins from version 1 do not count in version 2");
  await play(cookie, lesson, 0, true);
  await play(cookie, lesson, 1, true);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1], "the new block is still unwon");
  await play(cookie, lesson, 2, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
});

test("removing a block lets the remaining blocks of the new version decide", async () => {
  const lesson = await addTwoGameLesson();
  const cookie = await signUp(app, emailOf("removed"));
  await play(cookie, lesson, 1, true);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);

  await publishVersion(lesson, 2, [quizBlock("g1")]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1], "the version 1 win of g2 is not a win of g1");
  assert.equal(out(await play(cookie, lesson, 0, true)).complete, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1], "the removed g2 no longer blocks completion");
});

test("a changed block that reuses its id does not inherit the old win", async () => {
  const lesson = await addGameLesson([quizBlock("g1")]);
  const cookie = await signUp(app, emailOf("changed"));
  await play(cookie, lesson, 0, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);

  const harder = { ...quizBlock("g1"), props: { ...quizBlock("g1").props, kind: { kind: "quiz", questions: [{ prompt: "3 + 3?", options: ["5", "6"], answer: 1 }] } } };
  await publishVersion(lesson, 2, [harder]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
  assert.equal(out(await play(cookie, lesson, 0, true)).complete, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);

  const wins = await db.select().from(gameCompletions).where(eq(gameCompletions.lessonId, lesson.lessonId));
  assert.deepEqual(wins.map((w) => [w.partIdx, w.blockId]).sort(), [[0, "g1"], [1, "g1"]], "one win per version");
});

test("a game lesson completes only when every game block has been won", async () => {
  const lesson = await addTwoGameLesson();
  const rand = mulberry32(116);
  for (let run = 0; run < RUNS; run++) {
    const email = emailOf(`games${run}`);
    const cookie = await signedUp(email);
    for (let i = 0; i < ACTIONS; i++) {
      const res = await play(cookie, lesson, Math.floor(rand() * 2), rand() < 0.5);
      assert.ok(res.statusCode < 500, `run ${run} action ${i}: ${res.body}`);
      const learnerId = await learnerOf(email);

      const won = new Set((await db.select().from(gameCompletions).where(and(eq(gameCompletions.learnerId, learnerId), eq(gameCompletions.lessonId, lesson.lessonId), eq(gameCompletions.partIdx, 0)))).map((g) => g.blockId));
      const progress = await codequestLesson(cookie, lesson.slug);
      assert.equal(progress.done >= progress.total, won.has("g1") && won.has("g2"), `run ${run} action ${i}: won ${[...won].join(",")}`);
    }
  }
});
