import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { eq, sql } from "drizzle-orm";
import { EventEmitter } from "node:events";
import { env } from "../src/env.ts";
import { practiceCheck } from "../src/parts/practice.ts";
import { runStatus, startRun } from "../src/sandbox/run.ts";
import { db } from "../src/db/client.ts";
import { lessons, lessonVersions, partCompletions, paths, user, worlds, type PartSecret } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

const get = (cookie: string) => trpc(app, cookie).q("home.get");
const enroll = (cookie: string, slug: string) => trpc(app, cookie).m("paths.enroll", { slug });
const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const userId = async (email: string) => (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;

// Adds a lesson with one current version holding `content`; the world defaults to codequest (seeded by signUp).
async function addLesson(slug: string, kind: "learn" | "game-practice" | "practice", content: PartSecret, worldId?: string, status: "published" | "draft" = "published") {
  const world = worldId ?? (await db.select().from(worlds).where(eq(worlds.slug, "codequest")))[0]!.id;
  const [lesson] = await db.insert(lessons).values({ slug, title: slug, worldId: world, sourceKind: "authored", kind, status }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  return lesson!.id;
}

const learnPart: PartSecret = { kind: "learn", body: "Read this first." };
const gamePart: PartSecret = {
  kind: "game-practice",
  intro: "Sort the cart.",
  doc: {
    v: 1,
    blocks: [{ type: "game", id: "quiz-game", props: { title: "Quiz", goalText: "Answer.", alt: "A one question quiz about the cart.", hints: [], shell: {}, kind: { kind: "quiz", questions: [{ prompt: "2 + 2?", options: ["3", "4"], answer: 1 }] } } }],
  },
};

test("parts.complete: idempotent, predict is a no-op, invisible lessons are 404", async () => {
  const cookie = await signUp(app, "a@example.com");
  const otherCookie = await signUp(app, "b@example.com");
  await addLesson("learn-1", "learn", learnPart);
  await addLesson("draft-learn", "learn", learnPart, undefined, "draft");
  const [bWorld] = await db
    .insert(worlds)
    .values({ slug: "b-course", title: "B", visibility: "private", ownerId: await userId("b@example.com"), origin: "community" })
    .returning();
  await addLesson("b-learn", "learn", learnPart, bWorld!.id);

  assert.deepEqual(out(await m(cookie, "parts.complete", { lessonId: "learn-1" })), { ok: true });
  assert.deepEqual(out(await m(cookie, "parts.complete", { lessonId: "learn-1" })), { ok: true });
  assert.equal((await db.select().from(partCompletions)).length, 1);

  assert.deepEqual(out(await m(cookie, "parts.complete", { lessonId: "lesson-1" })), { ok: true });
  assert.equal((await db.select().from(partCompletions)).length, 1, "predict lessons store nothing");

  for (const lessonId of ["draft-learn", "b-learn", "nope"]) {
    const res = await m(cookie, "parts.complete", { lessonId });
    assert.equal(res.statusCode, 404);
    assert.equal(code(res), "NOT_FOUND");
  }
  assert.deepEqual(out(await m(otherCookie, "parts.complete", { lessonId: "b-learn" })), { ok: true });
});

test("a completed learn lesson counts as done in course, path and home progress", async () => {
  const cookie = await signUp(app);
  await enroll(cookie, "js-foundations");
  await addLesson("learn-1", "learn", learnPart);

  const lessonOf = async () => out(await trpc(app, cookie).q("courses.get", { slug: "codequest" })).lessons.find((l: { slug: string }) => l.slug === "learn-1");
  const before = await lessonOf();
  assert.deepEqual([before.done, before.total], [0, 1]);

  assert.deepEqual(out(await m(cookie, "parts.complete", { lessonId: "learn-1" })), { ok: true });

  const after = await lessonOf();
  assert.deepEqual([after.done, after.total], [1, 1]);
  const path = out(await trpc(app, cookie).q("paths.get", { slug: "js-foundations" }));
  assert.deepEqual([path.courses[0].lessonsDone, path.courses[0].lessonsTotal], [1, 2]);
  const home = out(await get(cookie));
  assert.deepEqual([home.paths[0].courses[0].lessonsDone, home.paths[0].courses[0].lessonsTotal], [1, 2]);
});

test("games.check: only a real game of a game-practice lesson records a win", async () => {
  const cookie = await signUp(app);
  await addLesson("game-1", "game-practice", gamePart);
  const win = { lessonId: "game-1", gameIndex: 0, submission: { kind: "quiz", answers: [1] } };

  assert.equal((await m(cookie, "games.check", { ...win, gameIndex: 1 })).statusCode, 404);
  assert.deepEqual(out(await m(cookie, "games.check", { ...win, submission: { kind: "quiz", answers: [0] } })).complete, false);
  assert.equal((await db.select().from(partCompletions)).length, 0, "no win, no completion");
  assert.equal(out(await m(cookie, "games.check", win)).complete, true);
  assert.equal((await db.select().from(partCompletions)).length, 1, "a recorded win completes the part");
  assert.equal(out(await m(cookie, "games.check", win)).complete, true);
  assert.equal(out(await get(cookie)).stats.xp, 10);

  await addLesson("learn-1", "learn", learnPart);
  assert.equal((await m(cookie, "games.check", { ...win, lessonId: "learn-1" })).statusCode, 404);
});

test("parts.complete rejects practice and game-practice without evidence", async () => {
  const cookie = await signUp(app);
  await addLesson("prac-1", "practice", { kind: "practice", instructions: "x", starterCode: "", expectedOutput: "1" });
  await addLesson("game-1", "game-practice", gamePart);
  for (const lessonId of ["prac-1", "game-1"]) {
    const res = await m(cookie, "parts.complete", { lessonId });
    assert.equal(code(res), "FORBIDDEN");
  }
  assert.equal((await db.select().from(partCompletions)).length, 0);
});

const pracPart: PartSecret = { kind: "practice", instructions: "Print 17.", language: "python", starterCode: "", expectedOutput: "17\n" };
// The learner row is created on the first signed-in request, so make one before looking it up.
const learnerOf = async (cookie: string, email: string) =>
  (await get(cookie), await db.execute<{ id: string }>(sql`SELECT l.id FROM learners l JOIN "user" u ON u.id = l.user_id WHERE u.email = ${email}`)).rows[0]!.id;

// A fake `docker run` that prints `output` and exits 0, so a checked run can end without a container.
const printing = (output: string) => (() => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: new EventEmitter(), kill() {} });
  setImmediate(() => { child.stdout.emit("data", Buffer.from(output)); child.emit("close", 0); });
  return child;
}) as never;
const settle = () => new Promise((r) => setTimeout(r, 50));

test("a practice lesson completes only after a matching server-checked run", async () => {
  const cookie = await signUp(app, "p@example.com");
  await enroll(cookie, "js-foundations");
  await addLesson("prac-1", "practice", pracPart);
  const me = await learnerOf(cookie, "p@example.com");

  assert.equal(code(await m(cookie, "parts.complete", { lessonId: "prac-1" })), "FORBIDDEN");
  assert.equal((await db.select().from(partCompletions)).length, 0, "an unplayed practice lesson has no row");

  const wrong = startRun("print(16)", me, "python", printing("16\n"), (await practiceCheck(me, "prac-1"))!)!;
  await settle();
  assert.equal(runStatus(wrong, me, 0)?.passed, false);
  assert.equal((await db.select().from(partCompletions)).length, 0, "a wrong answer records nothing");

  const right = startRun("print(17)", me, "python", printing("17\n"), (await practiceCheck(me, "prac-1"))!)!;
  await settle();
  assert.equal(runStatus(right, me, 0)?.passed, true);
  assert.equal((await db.select().from(partCompletions)).length, 1);

  const lesson = out(await trpc(app, cookie).q("courses.get", { slug: "codequest" })).lessons.find((l: { slug: string }) => l.slug === "prac-1");
  assert.deepEqual([lesson.done, lesson.total], [1, 1], "course progress counts the verified lesson");
  const home = out(await get(cookie));
  assert.equal(home.paths[0].courses[0].lessonsDone, 1, "home progress counts it too");
});

test("a checked run needs a published practice lesson the learner can see", async () => {
  const cookie = await signUp(app, "a@example.com");
  await signUp(app, "b@example.com");
  const me = await learnerOf(cookie, "a@example.com");
  await addLesson("prac-1", "practice", pracPart);
  await addLesson("learn-1", "learn", learnPart);
  await addLesson("draft-prac", "practice", pracPart, undefined, "draft");
  const [bWorld] = await db
    .insert(worlds)
    .values({ slug: "b-course", title: "B", visibility: "private", ownerId: await userId("b@example.com"), origin: "community" })
    .returning();
  await addLesson("b-prac", "practice", pracPart, bWorld!.id);

  assert.ok(await practiceCheck(me, "prac-1"));
  for (const lessonId of ["learn-1", "draft-prac", "b-prac", "nope"]) assert.equal(await practiceCheck(me, lessonId), null, lessonId);
});

test("POST /sandbox/run refuses a Check for a lesson that is not a visible practice lesson", async () => {
  const cookie = await signUp(app);
  await addLesson("learn-1", "learn", learnPart);
  const was = env.SANDBOX_ENABLED;
  env.SANDBOX_ENABLED = true;
  try {
    for (const lessonId of ["learn-1", "nope"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/run",
        headers: { cookie, origin: env.PUBLIC_ORIGIN },
        payload: { code: "print(1)", language: "python", lessonId },
      });
      assert.equal(res.statusCode, 404, lessonId);
    }
  } finally {
    env.SANDBOX_ENABLED = was;
  }
  assert.equal((await db.select().from(partCompletions)).length, 0);
});
