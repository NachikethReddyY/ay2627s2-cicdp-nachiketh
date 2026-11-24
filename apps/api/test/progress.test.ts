import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { lessonObservations, lessonVersions, lessons, learners, pathCourses, paths, stepProgress, steps, user, worlds } from "../src/db/schema.ts";
import { streak, week } from "../src/progress/streak.ts";
import { firstCodeBlock } from "../src/progress/home.ts";

const app = buildApp();
after(() => app.close());

const get = (cookie: string) => trpc(app, cookie).q("home.get");
const enroll = (cookie: string, slug: string) => trpc(app, cookie).m("paths.enroll", { slug });
const answer = (cookie: string, id: string, answer: object) => trpc(app, cookie).m("steps.attempt", { id, answer });
const q = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).q(path, input);
const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const userId = async (email: string) => (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;
const pathId = async (slug: string) => (await db.select({ id: paths.id }).from(paths).where(eq(paths.slug, slug)))[0]!.id;

test("extracts the first complete fenced code block", () => {
  assert.deepEqual(firstCodeBlock("intro\n```js\na\nb\n\n```\n```\nc\n```"), ["a", "b"]);
  assert.deepEqual(firstCodeBlock("```\n```"), [""]);
  assert.deepEqual(firstCodeBlock("```\n1\n2\n3\n4\n5\n6\n7\n```"), ["1", "2", "3", "4", "5", "6"]);
  assert.equal(firstCodeBlock("```js\nunterminated"), null);
  assert.equal(firstCodeBlock("no fence"), null);
  assert.equal(firstCodeBlock("```" + "x".repeat(100_000)), null);
});

test("streak counts back from today, or yesterday while today is open", () => {
  const m = new Map([["2026-10-27", 3], ["2026-10-28", 5], ["2026-10-29", 1]]);
  assert.equal(streak(m, "2026-10-29"), 2);
  m.set("2026-10-29", 3);
  assert.equal(streak(m, "2026-10-29"), 3);
  assert.equal(streak(m, "2026-10-31"), 0);
  assert.equal(streak(new Map([["2026-10-31", 3], ["2026-11-01", 3]]), "2026-11-01"), 2);
  assert.deepEqual(week(m, "2026-10-29").map((d) => d.day), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.deepEqual(week(m, "2026-10-29").map((d) => d.state), ["past", "past", "past", "today", "future", "future", "future"]);
});

test("401 without login", async () => {
  assert.equal((await trpc(app).q("home.get")).statusCode, 401);
});

test("new learner sees the official path and nothing to continue", async () => {
  const body = out(await get(await signUp(app)));
  assert.equal(body.continue, null);
  assert.equal(body.resume, null);
  assert.deepEqual(body.paths, []);
  assert.deepEqual(body.official.map((p: { slug: string }) => p.slug).sort(), ["js-foundations", "sample-courses"]);
  assert.equal(body.stats.xp, 0);
  assert.equal(body.stats.streak, 0);
  assert.equal(body.stats.week.length, 7);
});

test("enroll: unknown and private paths are 404, repeat is fine", async () => {
  const cookie = await signUp(app);
  assert.equal((await enroll(cookie, "nope")).statusCode, 404);
  await db.insert(paths).values({ slug: "secret", title: "S", visibility: "private", origin: "ai" });
  assert.equal((await enroll(cookie, "secret")).statusCode, 404);
  assert.equal((await enroll(cookie, "js-foundations")).statusCode, 200);
  assert.equal((await enroll(cookie, "js-foundations")).statusCode, 200);
});

test("enrolled learner gets continue, progress and XP", async () => {
  const cookie = await signUp(app);
  await enroll(cookie, "js-foundations");
  let body = out(await get(cookie));
  assert.deepEqual(body.continue.lesson, { slug: "codequest-pretest", title: body.continue.lesson.title, level: 0, done: 0, total: 3 });
  assert.equal(body.continue.course.slug, "codequest");
  assert.deepEqual(body.official, [
    { slug: "sample-courses", title: "Sample courses", tagline: "Short courses to try LearnSlop", origin: "official", courseCount: 2, learners: 0 },
  ]);

  assert.equal((await answer(cookie, "s1", { kind: "mcq", choice: 1 })).statusCode, 200);
  const inProgress = out(await get(cookie));
  assert.equal(inProgress.resume.lessonSlug, "lesson-1");
  assert.equal(inProgress.resume.courseSlug, "codequest");
  assert.equal((await answer(cookie, "s2", { kind: "cloze", text: "discount = 0" })).statusCode, 200);
  assert.equal((await answer(cookie, "s3", { kind: "mcq", choice: 1 })).statusCode, 200);

  body = out(await get(cookie));
  assert.equal(body.stats.xp, 45);
  assert.equal(body.stats.todayXp, 45);
  assert.equal(body.stats.streak, 1);
  assert.equal(body.continue.lesson.slug, "conditionals-1");
  assert.equal(body.resume, null);
  assert.deepEqual(body.paths[0].courses[0], { slug: "codequest", title: "Shopping Cart Basics", lessonsDone: 1, lessonsTotal: 2 });
});

test("game completion grants XP once and leaves lesson mastery unchanged", async () => {
  const cookie = await signUp(app);
  const before = (await db.select().from(stepProgress)).length;
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [game] = await db.insert(lessons).values({ slug: "game-xp", title: "Game", worldId: world!.id, sourceKind: "authored", kind: "game-practice", status: "published" }).returning();
  await db.insert(lessonVersions).values({ lessonId: game!.id, version: 1, content: { kind: "game-practice", intro: "Play.", doc: { v: 1, blocks: [{ type: "game", id: "quiz-one", props: { title: "Quiz", goalText: "Answer.", alt: "A one question quiz.", hints: [], shell: {}, kind: { kind: "quiz", questions: [{ prompt: "2 + 2?", options: ["3", "4"], answer: 1 }] } } }] } } });
  await db.update(lessons).set({ currentVersionId: (await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, game!.id)))[0]!.id }).where(eq(lessons.id, game!.id));
  const versionId = out(await trpc(app, cookie).q("lessons.get", { id: "game-xp" })).part.versionId;
  const input = { lessonId: "game-xp", versionId, gameIndex: 0, submission: { kind: "quiz", answers: [1] } };
  assert.equal(out(await m(cookie, "games.check", input)).complete, true);
  assert.equal(out(await m(cookie, "games.check", input)).complete, true, "a repeat win is accepted but earns nothing more");
  assert.equal(out(await get(cookie)).stats.xp, 10);
  assert.equal((await db.select().from(stepProgress)).length, before);
});

test("courses.get: published lessons only, private courses only for the owner", async () => {
  const cookie = await signUp(app, "a@example.com");
  const otherCookie = await signUp(app, "b@example.com");
  const [codequest] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  await db.insert(lessons).values({ slug: "draft-1", title: "Draft", worldId: codequest!.id, sourceKind: "authored", status: "draft" });
  await db.insert(worlds).values({ slug: "b-course", title: "B Course", visibility: "private", ownerId: await userId("b@example.com"), origin: "community" });

  assert.equal((await q(cookie, "courses.get", { slug: "nope" })).statusCode, 404);
  assert.equal((await q(cookie, "courses.get", { slug: "b-course" })).statusCode, 404);

  const res = await q(cookie, "courses.get", { slug: "codequest" });
  assert.equal(res.statusCode, 200);
  const body = out(res);
  assert.deepEqual(
    { slug: body.slug, title: body.title, description: body.description, origin: body.origin },
    { slug: "codequest", title: "Shopping Cart Basics", description: "Build a cart total, then test it.", origin: "official" },
  );
  assert.deepEqual(body.lessons.map(({ slug, level, done, total }: Record<string, number | string>) => ({ slug, level, done, total })), [
    { slug: "lesson-1", level: 1, done: 0, total: 3 },
    { slug: "conditionals-1", level: 1, done: 0, total: 3 },
  ]);

  await answer(cookie, "s1", { kind: "mcq", choice: 1 });
  assert.equal(out(await q(cookie, "courses.get", { slug: "codequest" })).lessons[0].done, 1);

  assert.equal((await q(otherCookie, "courses.get", { slug: "b-course" })).statusCode, 200);
});

test("paths.list: scopes, enrolled flag, search and visibility", async () => {
  const cookie = await signUp(app, "a@example.com");
  const otherCookie = await signUp(app, "b@example.com");
  const otherId = await userId("b@example.com");
  await db.insert(paths).values([
    { slug: "community-one", title: "Async Patterns", origin: "community" },
    { slug: "b-private", title: "B Secret", origin: "community", visibility: "private", ownerId: otherId },
    { slug: "a-draft", title: "A Draft", origin: "community", visibility: "private", ownerId: await userId("a@example.com") },
  ]);
  const slugs = async (input?: object, c = cookie) => out(await q(c, "paths.list", input)).map((p: { slug: string }) => p.slug);

  assert.deepEqual(await slugs(), ["js-foundations", "sample-courses"]);
  assert.deepEqual(
    out(await q(cookie, "paths.list"))[0],
    {
      slug: "js-foundations",
      title: "JavaScript Foundations",
      tagline: "Read real code and predict what it does",
      origin: "official",
      courseCount: 1,
      learners: 0,
      enrolled: false,
      visibility: "public",
      courses: [{ slug: "codequest", title: "Shopping Cart Basics" }],
    },
  );
  assert.deepEqual(await slugs({ scope: "community" }), ["community-one"]);
  assert.deepEqual(await slugs({ scope: "mine" }), ["a-draft"]);
  assert.deepEqual((await slugs({ scope: "mine" }, otherCookie)).sort(), ["b-private"]);
  assert.deepEqual(await slugs({ scope: "community", q: "ASYNC" }), ["community-one"]);
  assert.deepEqual(await slugs({ scope: "community", q: "%" }), []);
  assert.equal((await q(cookie, "paths.list", { q: "x".repeat(101) })).statusCode, 400);

  await enroll(cookie, "js-foundations");
  const enrolled = out(await q(cookie, "paths.list"))[0];
  assert.equal(enrolled.enrolled, true);
  assert.equal(enrolled.learners, 1);
});

test("paths.publish: owner only, publishes the owned courses", async () => {
  const cookie = await signUp(app, "a@example.com");
  const otherCookie = await signUp(app, "b@example.com");
  const otherId = await userId("b@example.com");
  await db.insert(paths).values({ slug: "b-private", title: "B Secret", visibility: "private", origin: "community", ownerId: otherId });
  const [world] = await db
    .insert(worlds)
    .values({ slug: "b-course", title: "B Course", visibility: "private", ownerId: otherId, origin: "community" })
    .returning();
  await db.insert(pathCourses).values({ pathId: await pathId("b-private"), worldId: world!.id, position: 0 });

  assert.equal((await m(cookie, "paths.publish", { slug: "b-private" })).statusCode, 404);
  assert.equal((await q(cookie, "courses.get", { slug: "b-course" })).statusCode, 404);
  assert.equal((await m(otherCookie, "paths.publish", { slug: "nope" })).statusCode, 404);

  assert.equal((await m(otherCookie, "paths.publish", { slug: "b-private" })).statusCode, 200);
  assert.ok(out(await q(cookie, "paths.list", { scope: "community" })).some((path: { slug: string }) => path.slug === "b-private"));
  assert.equal((await q(cookie, "courses.get", { slug: "b-course" })).statusCode, 200);
});

test("me.update: validates timezone and goal, empty body is a no-op", async () => {
  const cookie = await signUp(app, "a@example.com");
  assert.equal((await m(cookie, "me.update", { timezone: "Mars/Olympus" })).statusCode, 400);
  assert.equal((await m(cookie, "me.update", { dailyGoalXp: 25 })).statusCode, 400);
  for (const tz of ["+05:00", "-03:30", "UTC+5", "Mars/Olympus", ""]) {
    assert.equal((await m(cookie, "me.update", { timezone: tz })).statusCode, 400, tz);
  }
  assert.equal((await db.select().from(learners))[0]!.timezone, "UTC");

  assert.equal((await m(cookie, "me.update", { timezone: "Asia/Kolkata", dailyGoalXp: 100 })).statusCode, 200);
  const [row] = await db.select().from(learners);
  assert.deepEqual({ timezone: row!.timezone, goal: row!.dailyGoalXp }, { timezone: "Asia/Kolkata", goal: 100 });
  assert.equal(out(await get(cookie)).stats.dailyGoalXp, 100);
  assert.equal(out(await get(cookie)).stats.timezone, "Asia/Kolkata");

  assert.equal((await m(cookie, "me.update", null)).statusCode, 200);
  assert.equal((await m(cookie, "me.update", { dailyGoalXp: 30 })).statusCode, 200);
  const [after] = await db.select().from(learners);
  assert.deepEqual({ timezone: after!.timezone, goal: after!.dailyGoalXp }, { timezone: "Asia/Kolkata", goal: 30 });
});

test("paths never list another user's private course", async () => {
  const cookie = await signUp(app);
  const other = await signUp(app, "b@example.com");
  const [owner] = await db.execute<{ id: string }>(sql`SELECT id FROM "user" WHERE email = 'b@example.com'`).then((r) => r.rows);
  const [hidden] = await db.insert(worlds).values({ slug: "hidden", title: "Hidden", visibility: "private", ownerId: owner!.id }).returning();
  const [jsPath] = await db.select().from(paths).where(eq(paths.slug, "js-foundations"));
  await db.insert(pathCourses).values({ pathId: jsPath!.id, worldId: hidden!.id, position: 1 });
  await enroll(cookie, "js-foundations");

  const home = out(await get(cookie));
  assert.deepEqual(home.paths[0].courses.map((c: { slug: string }) => c.slug), ["codequest"]);
  const list = out(await q(cookie, "paths.list"));
  assert.deepEqual(list[0].courses.map((c: { slug: string }) => c.slug), ["codequest"]);
  assert.equal(list[0].courseCount, 1);
  const mine = out(await q(other, "paths.list"))[0];
  assert.equal(mine.courses.length, 2);
});

test("paths.publish fails closed when moderation is unavailable or flags the path", async () => {
  const { setModerationClient } = await import("../src/safety/moderation.ts");
  const clean = { flagged: false, scores: {} };
  const cookie = await signUp(app, "pub@example.com");
  const id = await userId("pub@example.com");
  await db.insert(paths).values({ slug: "pub-me", title: "Pub Me", visibility: "private", ownerId: id, origin: "ai" });
  const [world] = await db.insert(worlds).values({ slug: "pub-course", title: "Pub Course", visibility: "private", ownerId: id, origin: "ai" }).returning();
  await db.insert(pathCourses).values({ pathId: await pathId("pub-me"), worldId: world!.id, position: 0 });
  try {
    setModerationClient(async () => {
      throw new Error("Moderation is not configured");
    });
    let res = await m(cookie, "paths.publish", { slug: "pub-me" });
    assert.equal(res.statusCode, 503);
    assert.equal(code(res), "SERVICE_UNAVAILABLE");
    assert.match(res.json<{ error: { message: string } }>().error.message, /safety check couldn't run.*still private/);
    setModerationClient(async () => ({ flagged: true, scores: {} }));
    res = await m(cookie, "paths.publish", { slug: "pub-me" });
    assert.equal(code(res), "PRECONDITION_FAILED");
    assert.match(res.json<{ error: { message: string } }>().error.message, /didn't pass the automatic safety check.*still private/);
    const [still] = await db.select().from(paths).where(eq(paths.slug, "pub-me"));
    assert.equal(still!.visibility, "private");
    assert.equal((await db.select().from(worlds).where(eq(worlds.slug, "pub-course")))[0]!.visibility, "private");

    setModerationClient(async () => clean);
    assert.equal((await m(cookie, "paths.publish", { slug: "pub-me" })).statusCode, 200);
    assert.equal((await db.select().from(paths).where(eq(paths.slug, "pub-me")))[0]!.visibility, "public");
    setModerationClient(async () => { throw new Error("offline"); });
    assert.equal((await m(cookie, "paths.publish", { slug: "pub-me" })).statusCode, 200);
  } finally {
    setModerationClient(async () => clean);
  }
});


test("a pre-test records a once-only result without XP or mastery", async () => {
  const cookie = await signUp(app);
  await enroll(cookie, "js-foundations");
  const next = out(await q(cookie, "me.next", { world: "codequest" }));
  assert.equal(next.lessonSlug, "codequest-pretest");
  const response = out(await answer(cookie, "codequest-pretest-0", { kind: "mcq", choice: 0 }));
  assert.equal(response.correct, false);
  assert.equal(response.state, "revealed");
  assert.deepEqual(out(await q(cookie, "me.learning", { slug: "codequest" })), [
    { slug: "js.functions", pre: false, post: null },
  ]);
  const home = out(await get(cookie));
  assert.equal(home.stats.xp, 0);
  assert.deepEqual(home.mastery, []);
});

test("home and leaderboard count first tries and passes once, and streak counts misses", async () => {
  const cookie = await signUp(app);
  await m(cookie, "steps.hint", { id: "s1" });
  await answer(cookie, "s1", { kind: "mcq", choice: 1 });
  await answer(cookie, "s2", { kind: "cloze", text: "wrong" });
  await answer(cookie, "s3", { kind: "mcq", choice: 1 });
  const home = out(await get(cookie));
  assert.equal(home.stats.streak, 1);
  assert.equal(home.stats.xp, 15);
  assert.equal(home.leaderboard.xp, 15);
});

test("a due review grades once without revealing before the prediction", async () => {
  const cookie = await signUp(app);
  await answer(cookie, "s1", { kind: "mcq", choice: 1 });
  await db.execute(sql`
    INSERT INTO review_schedule (learner_id, concept_id, due_at)
    SELECT me.id, c.id, now() - interval '1 day' FROM learners me CROSS JOIN concepts c
    WHERE c.slug = 'js.array-reduce'
    ON CONFLICT (learner_id, concept_id) DO UPDATE SET due_at = EXCLUDED.due_at`);
  const input = { slug: "codequest" };
  const served = await q(cookie, "me.review.get", input);
  assert.equal(served.statusCode, 200, served.body);
  const question = out(served);
  assert.equal(question.kind, "mcq");
  assert.ok(!("answer" in question));
  const submitted = await m(cookie, "me.review.submit", { ...input, token: question.token, answer: { kind: "mcq", choice: 1 } });
  assert.equal(submitted.statusCode, 200, submitted.body);
  const result = out(submitted);
  assert.equal(result.correct, true);
  assert.equal((await m(cookie, "me.review.submit", { ...input, token: question.token, answer: { kind: "mcq", choice: 1 } })).statusCode, 409);
  assert.equal(out(await q(cookie, "me.review.get", input)), null);
  assert.equal((await db.select().from(lessonObservations)).length, 1);
});


test("the course unlocks a lesson when prerequisite mastery reaches 80%", async () => {
  const cookie = await signUp(app);
  const requirements = async () => {
    const result = out(await q(cookie, "courses.get", { slug: "variables" }));
    return result.lessons.find((l: { slug: string }) => l.slug === "variables-1").missingPrerequisites;
  };
  assert.deepEqual(await requirements(), ["values and types"]);
  assert.equal(code(await q(cookie, "lessons.get", { id: "variables-1" })), "PRECONDITION_FAILED");
  await db.execute(sql`
    INSERT INTO mastery (learner_id, concept_id, p_known, n_obs)
    SELECT learner.id, c.id, 0.79, 2 FROM learners learner CROSS JOIN concepts c
    WHERE c.slug = 'js.values-types'`);
  assert.deepEqual(await requirements(), ["values and types"]);
  await db.execute(sql`UPDATE mastery SET p_known = 0.8`);
  assert.deepEqual(await requirements(), []);
  assert.equal((await q(cookie, "lessons.get", { id: "variables-1" })).statusCode, 200);
});

test("the post-test compares a different prediction against the baseline", async () => {
  const cookie = await signUp(app);
  const world = "codequest";
  await answer(cookie, "codequest-pretest-0", { kind: "mcq", choice: 0 });
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT l.current_version_id AS id FROM lessons l JOIN worlds w ON w.id = l.world_id
    WHERE w.slug = ${world} AND l.assessment IS NULL AND l.status = 'published'`);
  for (const row of rows) {
    for (const step of await db.select().from(steps).where(eq(steps.lessonVersionId, row.id))) {
      const prediction = step.public.kind === "mcq"
        ? { kind: "mcq", choice: step.secret.answer }
        : { kind: "cloze", text: step.secret.answer };
      assert.equal((await answer(cookie, step.id, prediction)).statusCode, 200);
    }
  }
  assert.equal(out(await q(cookie, "me.next", { world })).lessonSlug, "codequest-posttest");
  assert.equal((await answer(cookie, "codequest-posttest-0", { kind: "mcq", choice: 2 })).statusCode, 200);
  assert.deepEqual(out(await q(cookie, "me.learning", { slug: world })), [
    { slug: "js.functions", pre: false, post: true },
  ]);
});
