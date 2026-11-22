import { code, out, readSteps, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { eq, sql } from "drizzle-orm";
import { EventEmitter } from "node:events";
import { env } from "../src/env.ts";
import { practiceCheck } from "../src/parts/practice.ts";
import { runStatus, startRun } from "../src/sandbox/run.ts";
import { db } from "../src/db/client.ts";
import { lessons, lessonVersions, partCompletions, steps, user, worlds, type PartSecret } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

const get = (cookie: string) => trpc(app, cookie).q("home.get");
const enroll = (cookie: string, slug: string) => trpc(app, cookie).m("paths.enroll", { slug });
const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const userId = async (email: string) => (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;

async function addLesson(slug: string, kind: "learn" | "game-practice" | "practice", content: PartSecret, worldId?: string, status: "published" | "draft" = "published") {
  const world = worldId ?? (await db.select().from(worlds).where(eq(worlds.slug, "codequest")))[0]!.id;
  const [lesson] = await db.insert(lessons).values({ slug, title: slug, worldId: world, sourceKind: "authored", kind, status }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  return lesson!.id;
}

async function addChecks(lessonId: string) {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  const rows = readSteps.map((s, idx) => ({
    lessonVersionId: lesson!.currentVersionId!,
    idx,
    public: { title: s.title, prompt: s.prompt, kind: s.kind, options: s.options },
    secret: { beforeFiles: s.beforeFiles, hunks: s.hunks, answer: s.answer, hints: s.hints, explanations: s.explanations, concepts: s.concepts },
  }));
  return db.insert(steps).values(rows).returning({ id: steps.id, idx: steps.idx });
}

const watchPart: PartSecret = {
  kind: "watch",
  beforeFiles: { "main.js": "let x = 1;\n" },
  hunks: [{ id: "h1", file: "main.js", oldStart: 1, lines: ["-let x = 1;", "+let x = 2;"] }],
};

const learnPart: PartSecret = { kind: "learn", body: "Read this first." };
const gamePart: PartSecret = {
  kind: "game-practice",
  intro: "Sort the cart.",
  doc: {
    v: 1,
    blocks: [{ type: "game", id: "quiz-game", props: { title: "Quiz", goalText: "Answer.", alt: "A one question quiz about the cart.", hints: [], shell: {}, kind: { kind: "quiz", questions: [{ prompt: "2 + 2?", options: ["3", "4"], answer: 1 }] } } }],
  },
};

test("parts.complete: read lessons require checks, predict is a no-op, invisible lessons are 404", async () => {
  const cookie = await signUp(app, "a@example.com");
  const otherCookie = await signUp(app, "b@example.com");
  await addLesson("learn-1", "learn", learnPart);
  await addLesson("draft-learn", "learn", learnPart, undefined, "draft");
  const [bWorld] = await db
    .insert(worlds)
    .values({ slug: "b-course", title: "B", visibility: "private", ownerId: await userId("b@example.com"), origin: "community" })
    .returning();
  await addLesson("b-learn", "learn", learnPart, bWorld!.id);

  assert.equal((await m(cookie, "parts.complete", { lessonId: "learn-1" })).statusCode, 403);
  assert.equal((await db.select().from(partCompletions)).length, 0);

  assert.deepEqual(out(await m(cookie, "parts.complete", { lessonId: "lesson-1" })), { ok: true });
  assert.equal((await db.select().from(partCompletions)).length, 0, "predict lessons store nothing");

  for (const lessonId of ["draft-learn", "b-learn", "nope"]) {
    const res = await m(cookie, "parts.complete", { lessonId });
    assert.equal(res.statusCode, 404);
    assert.equal(code(res), "NOT_FOUND");
  }
  assert.equal((await m(otherCookie, "parts.complete", { lessonId: "b-learn" })).statusCode, 403);
});

test("a completed learn lesson counts as done in course, path and home progress", async () => {
  const cookie = await signUp(app);
  await enroll(cookie, "js-foundations");
  const lessonId = await addLesson("learn-1", "learn", learnPart);
  const checks = await addChecks(lessonId);

  const lessonOf = async () => out(await trpc(app, cookie).q("courses.get", { slug: "codequest" })).lessons.find((l: { slug: string }) => l.slug === "learn-1");
  const before = await lessonOf();
  assert.deepEqual([before.done, before.total], [0, 1]);

  for (const check of checks) out(await m(cookie, "steps.attempt", { id: check.id, answer: { kind: "mcq", choice: 0 } }));

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
const learnerOf = async (cookie: string, email: string) =>
  (await get(cookie), await db.execute<{ id: string }>(sql`SELECT l.id FROM learners l JOIN "user" u ON u.id = l.user_id WHERE u.email = ${email}`)).rows[0]!.id;

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

for (const [kind, part] of [["learn", learnPart], ["watch", watchPart]] as const) {
  test(`a ${kind} lesson with checks does not complete on open and completes when its closing check is attempted`, async () => {
    const cookie = await signUp(app);
    const lessonId = await addLesson(`${kind}-checked`, kind as "learn", part);
    const [opening, closing] = await addChecks(lessonId);
    const done = () => db.select().from(partCompletions);

    const opened = out(await trpc(app, cookie).q("lessons.get", { id: `${kind}-checked` }));
    assert.deepEqual(opened.steps.map((s: { id: string }) => s.id), [opening!.id, closing!.id]);
    assert.equal((await m(cookie, "parts.complete", { lessonId: `${kind}-checked` })).statusCode, 403);
    assert.equal((await done()).length, 0, "opening the lesson completes nothing");

    const wrong = out(await trpc(app, cookie).m("steps.attempt", { id: opening!.id, answer: { kind: "mcq", choice: 1 } }));
    assert.equal(wrong.correct, false);
    assert.equal((await done()).length, 0, "the opening prediction is not the closing check");

    const skipClosing = await m(cookie, "steps.skip", { id: closing!.id });
    assert.equal(skipClosing.statusCode, 409, "the closing check cannot be skipped");
    const skipOpening = await m(cookie, "steps.skip", { id: opening!.id });
    assert.equal(skipOpening.statusCode, 409, "the opening prediction cannot be skipped");
    assert.equal((await done()).length, 0, "skipping completes nothing");
    assert.equal(out(await trpc(app, cookie).q("lessons.get", { id: `${kind}-checked` })).completed, false);
  });

  test(`a ${kind} closing check is refused until the opening prediction is attempted`, async () => {
    const cookie = await signUp(app);
    const lessonId = await addLesson(`${kind}-checked`, kind as "learn", part);
    const [opening, closing] = await addChecks(lessonId);
    const answer = { kind: "mcq", choice: 0 };

    const early = await m(cookie, "steps.attempt", { id: closing!.id, answer });
    assert.equal(early.statusCode, 409);
    assert.equal((await db.select().from(partCompletions)).length, 0);

    out(await trpc(app, cookie).m("steps.hint", { id: opening!.id }));
    const afterHint = await m(cookie, "steps.attempt", { id: closing!.id, answer });
    assert.equal(afterHint.statusCode, 409, "a hint is not a prediction");

    out(await trpc(app, cookie).m("steps.attempt", { id: opening!.id, answer: { kind: "mcq", choice: 1 } }));
    out(await trpc(app, cookie).m("steps.attempt", { id: closing!.id, answer }));
    assert.equal((await db.select().from(partCompletions)).length, 1);
    assert.equal(out(await trpc(app, cookie).q("lessons.get", { id: `${kind}-checked` })).completed, true);
  });

  test(`attempting the closing check of a ${kind} lesson completes it on a wrong answer`, async () => {
    const cookie = await signUp(app);
    const lessonId = await addLesson(`${kind}-checked`, kind as "learn", part);
    const [opening, closing] = await addChecks(lessonId);

    out(await trpc(app, cookie).m("steps.attempt", { id: opening!.id, answer: { kind: "mcq", choice: 0 } }));
    const wrong = out(await trpc(app, cookie).m("steps.attempt", { id: closing!.id, answer: { kind: "mcq", choice: 1 } }));
    assert.equal(wrong.state, "hinting");
    assert.equal((await db.select().from(partCompletions)).length, 1);
    const reopened = out(await trpc(app, cookie).q("lessons.get", { id: `${kind}-checked` }));
    assert.equal(reopened.completed, true, "a wrong closing answer still reads as complete on reopen");
    assert.equal(reopened.steps[1].state, "hinting");

    const lesson = out(await trpc(app, cookie).q("courses.get", { slug: "codequest" })).lessons.find((l: { slug: string }) => l.slug === `${kind}-checked`);
    assert.deepEqual([lesson.done, lesson.total], [1, 1]);
  });
}
