import { out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { attempts, gameCompletions, learners, lessons, lessonVersions, stepProgress, user, worlds, type PartSecret } from "../src/db/schema.ts";
import { seed } from "../src/db/seed.ts";
import { engineLearner } from "../src/engine-client/learner.ts";

const app = buildApp();
const realUpdate = engineLearner.update;
engineLearner.update = async (req) => req.priors.map((p) => ({ conceptId: p.conceptId, pPosterior: p.pKnown ?? 0.2, pNext: p.pKnown ?? 0.2 }));
after(() => {
  engineLearner.update = realUpdate;
  return app.close();
});

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
    const email = `predict${run}@example.com`;
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

test("skipping every predict step never completes the lesson", async () => {
  const cookie = await signUp(app);
  for (const step of PREDICT_STEPS) assert.equal((await m(cookie, "steps.skip", { id: step.id })).statusCode, 200);
  assert.equal((await codequestLesson(cookie, "lesson-1")).done, 0);
});

const quizBlock = (id: string) => ({
  type: "game",
  id,
  props: { title: id, goalText: "Win.", alt: "A quiz.", hints: [], shell: {}, kind: { kind: "quiz", questions: [{ prompt: "2 + 2?", options: ["3", "4"], answer: 1 }] } },
});

async function addTwoGameLesson() {
  await seed();
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const content: PartSecret = { kind: "game-practice", intro: "Play.", doc: { v: 1, blocks: [quizBlock("g1"), quizBlock("g2")] } as never };
  const [lesson] = await db.insert(lessons).values({ slug: "games-two", title: "Games", worldId: world!.id, sourceKind: "authored", kind: "game-practice", status: "published" }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
}

const play = (cookie: string, gameIndex: number, right: boolean) =>
  m(cookie, "games.check", { lessonId: "games-two", gameIndex, submission: { kind: "quiz", answers: [right ? 1 : 0] } });

test("winning one of two games does not complete a game lesson", async () => {
  await addTwoGameLesson();
  const cookie = await signUp(app);
  assert.equal(out(await play(cookie, 0, true)).complete, true);
  assert.equal(out(await play(cookie, 0, true)).complete, true);
  assert.equal((await codequestLesson(cookie, "games-two")).done, 0);
  assert.equal(out(await play(cookie, 1, false)).complete, false);
  assert.equal((await codequestLesson(cookie, "games-two")).done, 0);
  assert.equal(out(await play(cookie, 1, true)).complete, true);
  assert.equal((await codequestLesson(cookie, "games-two")).done, 1);
});

test("a game lesson completes only when every game block has been won", async () => {
  await addTwoGameLesson();
  const rand = mulberry32(116);
  for (let run = 0; run < RUNS; run++) {
    const email = `games${run}@example.com`;
    const cookie = await signedUp(email);
    for (let i = 0; i < ACTIONS; i++) {
      const res = await play(cookie, Math.floor(rand() * 2), rand() < 0.5);
      assert.ok(res.statusCode < 500, `run ${run} action ${i}: ${res.body}`);
      const learnerId = await learnerOf(email);

      const won = new Set((await db.select().from(gameCompletions).where(and(eq(gameCompletions.learnerId, learnerId), eq(gameCompletions.partIdx, 0)))).map((g) => g.blockId));
      const lesson = await codequestLesson(cookie, "games-two");
      assert.equal(lesson.done >= lesson.total, won.has("g1") && won.has("g2"), `run ${run} action ${i}: won ${[...won].join(",")}`);
    }
  }
});
