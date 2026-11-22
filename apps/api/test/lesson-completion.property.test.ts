import { out, signUp, trpc } from "./helpers.ts";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { withTx } from "../src/db/tx.ts";
import { attempts, gameCompletions, learners, lessons, lessonVersions, stepProgress, user, worlds, type PartSecret } from "../src/db/schema.ts";
import { lessonDone } from "../src/progress/shared.ts";
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
const predictDone = async (learnerId: string) => {
  const result = await db.execute<{ done: number }>(sql`SELECT ${lessonDone(learnerId)} AS done FROM lessons l WHERE l.slug = 'lesson-1'`);
  return Number(result.rows[0]?.done ?? 0);
};

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

test("a legacy first-action predict skip needs a new answer and keeps its observation", async () => {
  const email = emailOf("legacy-skip");
  const cookie = await signUp(app, email);
  assert.equal((await q(cookie, "home.get")).statusCode, 200);
  const [learner] = await db.select({ id: learners.id }).from(learners);
  const learnerId = learner!.id;
  await db.insert(stepProgress).values({ learnerId, stepId: "s1", state: "skipped" });
  await db.insert(attempts).values({ learnerId, stepId: "s1", kind: "skip", observed: true });

  assert.equal(out(await q(cookie, "lessons.get", { id: "lesson-1" })).steps[0].state, "predicting");
  assert.equal(out(await q(cookie, "steps.get", { id: "s1" })).state, "predicting");
  assert.equal((await q(cookie, "steps.reveal", { id: "s1" })).statusCode, 409);
  const answers = await Promise.all(Array.from({ length: 10 }, () => m(cookie, "steps.attempt", { id: "s1", answer: { kind: "mcq", choice: 1 } })));
  assert.equal(answers.filter((answer) => answer.statusCode === 200).length, 1);
  assert.equal(answers.filter((answer) => answer.statusCode === 409).length, 9);
  assert.equal(out(answers.find((answer) => answer.statusCode === 200)!).state, "revealed");

  const rows = await db.select().from(attempts).where(and(eq(attempts.learnerId, learnerId), eq(attempts.stepId, "s1")));
  assert.deepEqual(rows.map((row) => [row.kind, row.observed]), [["skip", true], ["mcq", false]]);
  assert.equal(await predictDone(learnerId), 1);
});

test("a legacy wrong-answer-then-skip predict step accepts a new answer", async () => {
  const email = emailOf("legacy-wrong-skip");
  const cookie = await signUp(app, email);
  assert.equal((await q(cookie, "home.get")).statusCode, 200);
  const [learner] = await db.select({ id: learners.id }).from(learners);
  const learnerId = learner!.id;
  const wrong = await m(cookie, "steps.attempt", { id: "s1", answer: { kind: "mcq", choice: 0 } });
  assert.equal(out(wrong).state, "hinting");
  await db.insert(attempts).values({ learnerId, stepId: "s1", kind: "skip", observed: false });
  await db.update(stepProgress).set({ state: "skipped" }).where(and(eq(stepProgress.learnerId, learnerId), eq(stepProgress.stepId, "s1")));

  assert.equal(out(await q(cookie, "lessons.get", { id: "lesson-1" })).steps[0].state, "predicting");
  assert.equal(out(await m(cookie, "steps.attempt", { id: "s1", answer: { kind: "mcq", choice: 1 } })).state, "revealed");

  const rows = await db.select().from(attempts).where(and(eq(attempts.learnerId, learnerId), eq(attempts.stepId, "s1")));
  assert.deepEqual(rows.map((row) => [row.kind, row.observed]), [["mcq", true], ["skip", false], ["mcq", false]]);
  assert.equal(await predictDone(learnerId), 1);
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

const play = async (cookie: string, lesson: GameLesson, gameIndex: number, right: boolean) => {
  const versionId = out(await q(cookie, "lessons.get", { id: lesson.slug })).part.versionId;
  return m(cookie, "games.check", { lessonId: lesson.slug, versionId, gameIndex, submission: { kind: "quiz", answers: [right ? 1 : 0] } });
};

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

const xpOf = async (cookie: string): Promise<number> => out(await q(cookie, "home.get")).stats.xp;

const winRows = async (lesson: GameLesson) => db.select().from(gameCompletions).where(eq(gameCompletions.lessonId, lesson.lessonId));

test("a submission from an older lesson version cannot win the new game", async () => {
  const lesson = await addGameLesson([quizBlock("g1")]);
  const cookie = await signUp(app, emailOf("stale-game"));
  const versionId = out(await q(cookie, "lessons.get", { id: lesson.slug })).part.versionId;
  const original = quizBlock("g1");
  await publishVersion(lesson, 2, [{ ...original, props: { ...original.props, title: "Changed" } }]);
  const response = await m(cookie, "games.check", { lessonId: lesson.slug, versionId, gameIndex: 0, submission: { kind: "quiz", answers: [1] } });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
  assert.equal(await xpOf(cookie), 0);
  assert.equal((await q(cookie, "games.hint", { lessonId: lesson.slug, versionId, gameIndex: 0, hintIndex: 0 })).statusCode, 409);
  assert.equal(out(await play(cookie, lesson, 0, true)).complete, true);
});

test("a versionless client can play the first version and receives a reload conflict after publication", async () => {
  const block = quizBlock("g1");
  const original = { ...block, props: { ...block.props, hints: ["Original hint"] } };
  const lesson = await addGameLesson([original]);
  const cookie = await signUp(app, emailOf("versionless"));
  const game = { lessonId: lesson.slug, gameIndex: 0 };
  const submission = { ...game, submission: { kind: "quiz", answers: [1] } };
  assert.deepEqual(out(await q(cookie, "games.hint", { ...game, hintIndex: 0 })), { text: "Original hint" });
  assert.equal(out(await m(cookie, "games.check", submission)).complete, true);

  await publishVersion(lesson, 2, [{ ...original, props: { ...original.props, hints: ["Updated hint"] } }]);
  const rejected = [
    await m(cookie, "games.check", submission),
    await q(cookie, "games.hint", { ...game, hintIndex: 0 }),
  ];
  for (const response of rejected) {
    assert.equal(response.statusCode, 409);
    assert.match(response.body, /Reload it to continue/);
  }
  assert.equal(await xpOf(cookie), 10);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
});

test("a submission waiting for publication rechecks the lesson version before granting a win", { timeout: 8000 }, async () => {
  const block = quizBlock("g1");
  const lesson = await addGameLesson([block]);
  const cookie = await signUp(app, emailOf("publish-race"));
  const versionId = out(await q(cookie, "lessons.get", { id: lesson.slug })).part.versionId;
  const [next] = await db.insert(lessonVersions).values({
    lessonId: lesson.lessonId, version: 2, content: gameContent([quizBlock("g2")]),
  }).returning();
  let pending: Promise<Awaited<ReturnType<typeof m>>> | undefined;

  await withTx(async (tx, publisher) => {
    await tx.update(lessons).set({ currentVersionId: next!.id }).where(eq(lessons.id, lesson.lessonId));
    const { rows: [publication] } = await publisher.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    pending = m(cookie, "games.check", { lessonId: lesson.slug, versionId, gameIndex: 0, submission: { kind: "quiz", answers: [1] } }).then((response) => response);
    for (let i = 0; i < 100; i++) {
      const { rows: [row] } = await pool.query<{ blocked: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))) AS blocked",
        [publication.pid],
      );
      if (row.blocked) return;
      await delay(10);
    }
    assert.fail("The game check did not wait for the lesson publication");
  });

  assert.equal((await pending!).statusCode, 409);
  assert.deepEqual(await winRows(lesson), []);
  assert.equal(await xpOf(cookie), 0);
});

test("identical games keep independent wins and XP when they are reordered", async () => {
  const first = quizBlock("g1");
  const second = { ...first, id: "g2" };
  const lesson = await addGameLesson([first, second]);
  const cookie = await signUp(app, emailOf("identical-games"));
  await play(cookie, lesson, 0, true);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
  assert.equal(await xpOf(cookie), 10);

  await publishVersion(lesson, 2, [second, first]);
  await play(cookie, lesson, 1, true);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
  assert.equal(await xpOf(cookie), 10);
  await play(cookie, lesson, 0, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 20);
});

test("existing wins of identical games and prior versions each retain the XP already awarded", async () => {
  const first = quizBlock("g1");
  const second = { ...first, id: "g2" };
  const lesson = await addGameLesson([first, second]);
  await publishVersion(lesson, 2, [second, first]);
  const email = emailOf("legacy-identical-games");
  const cookie = await signedUp(email);
  const learnerId = await learnerOf(email);
  await db.insert(gameCompletions).values([
    { learnerId, lessonId: lesson.lessonId, partIdx: 0, blockId: "g1" },
    { learnerId, lessonId: lesson.lessonId, partIdx: 0, blockId: "g2" },
    { learnerId, lessonId: lesson.lessonId, partIdx: 1, blockId: "g1" },
  ]);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 30);
  await play(cookie, lesson, 0, true);
  await play(cookie, lesson, 1, true);
  assert.equal(await xpOf(cookie), 30);
});

test("a block added in a new version keeps old wins, needs its own win, and awards no XP for old blocks", async () => {
  const lesson = await addTwoGameLesson();
  const cookie = await signUp(app, emailOf("added"));
  await play(cookie, lesson, 0, true);
  await play(cookie, lesson, 1, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 20);

  await publishVersion(lesson, 2, [quizBlock("g1"), quizBlock("g2"), quizBlock("g3")]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1], "the new block is unwon");
  assert.equal(await xpOf(cookie), 20);
  await play(cookie, lesson, 2, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1], "the unchanged blocks did not need a replay");
  assert.equal(await xpOf(cookie), 30);
  await play(cookie, lesson, 0, true);
  await play(cookie, lesson, 1, true);
  assert.equal(await xpOf(cookie), 30, "replaying the old blocks in the new version awards nothing");
});

test("removing a block lets the remaining blocks of the new version decide", async () => {
  const lesson = await addTwoGameLesson();
  const both = await signUp(app, emailOf("removed-both"));
  const second = await signUp(app, emailOf("removed-second"));
  await play(both, lesson, 0, true);
  await play(both, lesson, 1, true);
  await play(second, lesson, 1, true);
  assert.deepEqual(await progressOf(both, lesson), [1, 1]);
  assert.deepEqual(await progressOf(second, lesson), [0, 1]);

  await publishVersion(lesson, 2, [quizBlock("g1")]);
  assert.deepEqual(await progressOf(both, lesson), [1, 1], "the win of g1 carries and the removed g2 no longer blocks");
  assert.equal(await xpOf(both), 20);
  assert.deepEqual(await progressOf(second, lesson), [0, 1], "the win of the removed g2 does not stand in for g1");
  assert.equal(out(await play(second, lesson, 0, true)).complete, true);
  assert.deepEqual(await progressOf(second, lesson), [1, 1]);
  assert.equal(await xpOf(second), 20);
});

test("a changed block that reuses its id needs a new win, awards XP once, and a restored block carries its old win", async () => {
  const original = quizBlock("g1");
  const lesson = await addGameLesson([original]);
  const cookie = await signUp(app, emailOf("changed"));
  await play(cookie, lesson, 0, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 10);

  const harder = { ...original, props: { ...original.props, kind: { kind: "quiz", questions: [{ prompt: "3 + 3?", options: ["5", "6"], answer: 1 }] } } };
  await publishVersion(lesson, 2, [harder]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1], "the changed content does not inherit the win");
  assert.equal(await xpOf(cookie), 10);
  assert.equal(out(await play(cookie, lesson, 0, true)).complete, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 20);
  await play(cookie, lesson, 0, true);
  assert.equal(await xpOf(cookie), 20);

  await publishVersion(lesson, 3, [original]);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1], "content that was already won stays won");
  assert.equal(await xpOf(cookie), 20);
});

test("an unchanged block after a version bump keeps its win and awards no new XP, even under another id", async () => {
  const lesson = await addGameLesson([quizBlock("g1")]);
  const cookie = await signUp(app, emailOf("unchanged"));
  await play(cookie, lesson, 0, true);
  assert.equal(await xpOf(cookie), 10);

  await publishVersion(lesson, 2, [quizBlock("g1")]);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  await play(cookie, lesson, 0, true);
  assert.equal(await xpOf(cookie), 10);

  await publishVersion(lesson, 3, [{ ...quizBlock("g1"), id: "renamed" }]);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  await play(cookie, lesson, 0, true);
  assert.equal(await xpOf(cookie), 10);
});

test("replaying a won block in the same version, even concurrently, stores one win and awards XP once", async () => {
  const lesson = await addTwoGameLesson();
  const cookie = await signUp(app, emailOf("replay"));
  const results = await Promise.all([0, 1, 2, 3, 4].map(() => play(cookie, lesson, 0, true)));
  for (const res of results) assert.equal(out(res).complete, true);
  await play(cookie, lesson, 0, true);
  assert.equal(await xpOf(cookie), 10);
  const rows = await winRows(lesson);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.partIdx, 0);
  assert.equal(rows[0]!.blockId, "g1");
});

test("wins recorded before content identities read as wins of the block in version 1", async () => {
  const lesson = await addTwoGameLesson();
  const email = emailOf("legacy");
  const cookie = await signedUp(email);
  const learnerId = await learnerOf(email);
  await db.insert(gameCompletions).values([
    { learnerId, lessonId: lesson.lessonId, partIdx: 0, blockId: "g1" },
    { learnerId, lessonId: lesson.lessonId, partIdx: 0, blockId: "gone" },
  ]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
  assert.equal(await xpOf(cookie), 20, "every existing row keeps its XP");
  assert.equal(out(await play(cookie, lesson, 1, true)).complete, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 30);

  await publishVersion(lesson, 2, [quizBlock("g1"), quizBlock("g2"), quizBlock("g3")]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
  await play(cookie, lesson, 0, true);
  assert.equal(await xpOf(cookie), 30, "the legacy win of g1 is not paid again");
  await play(cookie, lesson, 2, true);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 40);
});

test("version-indexed wins use the content of the version where they were earned", async () => {
  const original = quizBlock("g1");
  const changed = { ...original, props: { ...original.props, title: "Changed" } };
  const lesson = await addGameLesson([original]);
  await publishVersion(lesson, 2, [changed, quizBlock("g2")]);
  const email = emailOf("versioned-legacy");
  const cookie = await signedUp(email);
  const learnerId = await learnerOf(email);
  await db.insert(gameCompletions).values([
    { learnerId, lessonId: lesson.lessonId, partIdx: 1, blockId: "g1" },
    { learnerId, lessonId: lesson.lessonId, partIdx: 1, blockId: "g2" },
  ]);
  assert.deepEqual(await progressOf(cookie, lesson), [1, 1]);
  assert.equal(await xpOf(cookie), 20);
  await play(cookie, lesson, 0, true);
  await play(cookie, lesson, 1, true);
  assert.equal(await xpOf(cookie), 20);
  await publishVersion(lesson, 3, [original]);
  assert.deepEqual(await progressOf(cookie, lesson), [0, 1]);
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

      const won = (await db.select().from(gameCompletions).where(and(eq(gameCompletions.learnerId, learnerId), eq(gameCompletions.lessonId, lesson.lessonId)))).length;
      const progress = await codequestLesson(cookie, lesson.slug);
      assert.equal(progress.done >= progress.total, won === 2, `run ${run} action ${i}: won ${won} of 2`);
    }
  }
});
