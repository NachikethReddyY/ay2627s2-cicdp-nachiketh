import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { lessons, lessonVersions, partCompletions, paths, user, worlds, type PartSecret } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

const get = (cookie: string) => trpc(app, cookie).q("home.get");
const enroll = (cookie: string, slug: string) => trpc(app, cookie).m("paths.enroll", { slug });
const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
const userId = async (email: string) => (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]!.id;

// Adds a lesson with one current version holding `content`; the world defaults to codequest (seeded by signUp).
async function addLesson(slug: string, kind: "learn" | "game-practice", content: PartSecret, worldId?: string, status: "published" | "draft" = "published") {
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
  doc: { v: 1, blocks: [{ type: "game", id: "sort-game", props: {} }] },
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

test("games.complete: only a real game block of a game-practice lesson at partIdx 0", async () => {
  const cookie = await signUp(app);
  await addLesson("game-1", "game-practice", gamePart);
  const real = { lessonId: "game-1", partIdx: 0, blockId: "sort-game" };

  assert.deepEqual(out(await m(cookie, "games.complete", { ...real, blockId: "made-up" })), { awarded: false });
  assert.deepEqual(out(await m(cookie, "games.complete", { ...real, partIdx: 1 })), { awarded: false });
  assert.deepEqual(out(await m(cookie, "games.complete", real)), { awarded: true });
  assert.deepEqual(out(await m(cookie, "games.complete", real)), { awarded: false });
  assert.equal(out(await get(cookie)).stats.xp, 10);

  await addLesson("learn-1", "learn", learnPart);
  assert.deepEqual(out(await m(cookie, "games.complete", { lessonId: "learn-1", partIdx: 0, blockId: "sort-game" })), { awarded: false });
});
