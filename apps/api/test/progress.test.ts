import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { lessonVersions, lessons, learners, pathCourses, paths, stepProgress, user, worlds } from "../src/db/schema.ts";
import { streak, week } from "../src/progress/streak.ts";

const app = buildApp();
after(() => app.close());

const get = (cookie: string) => trpc(app, cookie).q("home.get");
const enroll = (cookie: string, slug: string) => trpc(app, cookie).m("paths.enroll", { slug });
const answer = (cookie: string, id: string, answer: object) => trpc(app, cookie).m("steps.attempt", { id, answer });
const q = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).q(path, input);
const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const userId = async (email: string) => (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;
const pathId = async (slug: string) => (await db.select({ id: paths.id }).from(paths).where(eq(paths.slug, slug)))[0]!.id;

test("streak counts back from today, or yesterday while today is open", () => {
  const m = new Map([["2026-10-27", 3], ["2026-10-28", 5], ["2026-10-29", 1]]);
  assert.equal(streak(m, "2026-10-29"), 2);
  m.set("2026-10-29", 3);
  assert.equal(streak(m, "2026-10-29"), 3);
  assert.equal(streak(m, "2026-10-31"), 0);
  // Crosses a month boundary.
  assert.equal(streak(new Map([["2026-10-31", 3], ["2026-11-01", 3]]), "2026-11-01"), 2);
  assert.deepEqual(week(m, "2026-10-29").map((d) => d.day)[0], "2026-10-23");
});

test("401 without login", async () => {
  assert.equal((await trpc(app).q("home.get")).statusCode, 401);
});

test("new learner sees the official path and nothing to continue", async () => {
  const body = out(await get(await signUp(app)));
  assert.equal(body.continue, null);
  assert.deepEqual(body.paths, []);
  assert.equal(body.official[0].slug, "js-foundations");
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
  assert.deepEqual(body.continue.lesson, { slug: "lesson-1", title: body.continue.lesson.title, level: 1, done: 0, total: 3 });
  assert.equal(body.continue.course.slug, "codequest");
  assert.deepEqual(body.official, []);

  assert.equal((await answer(cookie, "s1", { kind: "mcq", choice: 1 })).statusCode, 200);
  assert.equal((await answer(cookie, "s2", { kind: "cloze", text: "discount = 0" })).statusCode, 200);
  assert.equal((await answer(cookie, "s3", { kind: "mcq", choice: 1 })).statusCode, 200);

  body = out(await get(cookie));
  assert.equal(body.stats.xp, 45);
  assert.equal(body.stats.todayXp, 45);
  assert.equal(body.stats.streak, 1);
  assert.equal(body.continue, null, "only lesson is finished");
  assert.deepEqual(body.paths[0].courses[0], { slug: "codequest", title: "Shopping Cart Basics", lessonsDone: 1, lessonsTotal: 1 });
});

test("game completion grants XP once and leaves lesson mastery unchanged", async () => {
  const cookie = await signUp(app);
  const before = (await db.select().from(stepProgress)).length;
  // games.complete only counts a real game block of a game-practice lesson, so seed one.
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [game] = await db.insert(lessons).values({ slug: "game-xp", title: "Game", worldId: world!.id, sourceKind: "authored", kind: "game-practice", status: "published" }).returning();
  await db.insert(lessonVersions).values({ lessonId: game!.id, version: 1, content: { kind: "game-practice", intro: "Play.", doc: { v: 1, blocks: [{ type: "game", id: "quiz-one", props: {} }] } } });
  await db.update(lessons).set({ currentVersionId: (await db.select().from(lessonVersions).where(eq(lessonVersions.lessonId, game!.id)))[0]!.id }).where(eq(lessons.id, game!.id));
  const input = { lessonId: "game-xp", partIdx: 0, blockId: "quiz-one" };
  assert.deepEqual(out(await m(cookie, "games.complete", input)), { awarded: true });
  assert.deepEqual(out(await m(cookie, "games.complete", input)), { awarded: false });
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

  assert.deepEqual(await slugs(), ["js-foundations"]);
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

test("paths.get: private paths are 404 except to their owner", async () => {
  const cookie = await signUp(app, "a@example.com");
  const otherCookie = await signUp(app, "b@example.com");
  await db.insert(paths).values({ slug: "b-private", title: "B Secret", visibility: "private", ownerId: await userId("b@example.com") });

  assert.equal((await q(cookie, "paths.get", { slug: "nope" })).statusCode, 404);
  assert.equal((await q(cookie, "paths.get", { slug: "b-private" })).statusCode, 404);
  const mine = out(await q(otherCookie, "paths.get", { slug: "b-private" }));
  assert.deepEqual(
    { visibility: mine.visibility, mine: mine.mine, enrolled: mine.enrolled, courses: mine.courses },
    { visibility: "private", mine: true, enrolled: false, courses: [] },
  );

  const detail = out(await q(cookie, "paths.get", { slug: "js-foundations" }));
  assert.equal(detail.mine, false);
  assert.deepEqual(detail.courses, [
    { slug: "codequest", title: "Shopping Cart Basics", description: "Build a cart total, then test it.", lessonsDone: 0, lessonsTotal: 1 },
  ]);
  for (const step of ["s1", "s2", "s3"]) await answer(cookie, step, step === "s2" ? { kind: "cloze", text: "discount = 0" } : { kind: "mcq", choice: 1 });
  assert.equal(out(await q(cookie, "paths.get", { slug: "js-foundations" })).courses[0].lessonsDone, 1);
});

test("paths.publish: owner only, publishes the owned courses", async () => {
  const cookie = await signUp(app, "a@example.com");
  const otherCookie = await signUp(app, "b@example.com");
  const otherId = await userId("b@example.com");
  await db.insert(paths).values({ slug: "b-private", title: "B Secret", visibility: "private", ownerId: otherId });
  const [world] = await db
    .insert(worlds)
    .values({ slug: "b-course", title: "B Course", visibility: "private", ownerId: otherId, origin: "community" })
    .returning();
  await db.insert(pathCourses).values({ pathId: await pathId("b-private"), worldId: world!.id, position: 0 });

  assert.equal((await m(cookie, "paths.publish", { slug: "b-private" })).statusCode, 404);
  assert.equal((await q(cookie, "paths.get", { slug: "b-private" })).statusCode, 404);
  assert.equal((await m(otherCookie, "paths.publish", { slug: "nope" })).statusCode, 404);

  assert.equal((await m(otherCookie, "paths.publish", { slug: "b-private" })).statusCode, 200);
  assert.equal(out(await q(cookie, "paths.get", { slug: "b-private" })).visibility, "public");
  assert.equal((await q(cookie, "courses.get", { slug: "b-course" })).statusCode, 200);
});

test("me.update: validates timezone and goal, empty body is a no-op", async () => {
  const cookie = await signUp(app, "a@example.com");
  assert.equal((await m(cookie, "me.update", { timezone: "Mars/Olympus" })).statusCode, 400);
  assert.equal((await m(cookie, "me.update", { dailyGoalXp: 25 })).statusCode, 400);
  // Intl accepts offsets; Postgres reads them with the opposite sign, so they are rejected.
  for (const tz of ["+05:00", "-03:30", "UTC+5", "Mars/Olympus", ""]) {
    assert.equal((await m(cookie, "me.update", { timezone: tz })).statusCode, 400, tz);
  }
  assert.equal((await db.select().from(learners))[0]!.timezone, "UTC");

  assert.equal((await m(cookie, "me.update", { timezone: "Asia/Kolkata", dailyGoalXp: 100 })).statusCode, 200);
  const [row] = await db.select().from(learners);
  assert.deepEqual({ timezone: row!.timezone, goal: row!.dailyGoalXp }, { timezone: "Asia/Kolkata", goal: 100 });
  assert.equal(out(await get(cookie)).stats.dailyGoalXp, 100);
  // home.get reports the stored zone so another device's browser can tell its own zone differs.
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
  const detail = out(await q(cookie, "paths.get", { slug: "js-foundations" }));
  assert.equal(detail.courses.length, 1);
  // The owner still sees it.
  const mine = out(await q(other, "paths.get", { slug: "js-foundations" }));
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
    // Provider down (the same error the real provider throws without MODERATION_API_KEY).
    setModerationClient(async () => {
      throw new Error("Moderation is not configured");
    });
    let res = await m(cookie, "paths.publish", { slug: "pub-me" });
    assert.equal(code(res), "PRECONDITION_FAILED");
    setModerationClient(async () => ({ flagged: true, scores: {} }));
    res = await m(cookie, "paths.publish", { slug: "pub-me" });
    assert.equal(code(res), "PRECONDITION_FAILED");
    const [still] = await db.select().from(paths).where(eq(paths.slug, "pub-me"));
    assert.equal(still!.visibility, "private");
    assert.equal((await db.select().from(worlds).where(eq(worlds.slug, "pub-course")))[0]!.visibility, "private");

    setModerationClient(async () => clean);
    assert.equal((await m(cookie, "paths.publish", { slug: "pub-me" })).statusCode, 200);
    assert.equal((await db.select().from(paths).where(eq(paths.slug, "pub-me")))[0]!.visibility, "public");
  } finally {
    setModerationClient(async () => clean);
  }
});
