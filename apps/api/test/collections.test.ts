import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { learners, paths, user } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

const q = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).q(path, input);
const m = (cookie: string, path: string, input?: unknown) => trpc(app, cookie).m(path, input);
async function makeAdmin(email: string) {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  await db.update(learners).set({ isAdmin: true }).where(eq(learners.userId, u!.id));
}
// Signs up an admin, and a plain learner, returning both cookies.
async function setup() {
  const admin = await signUp(app, "admin@example.com");
  await q(admin, "collections.list"); // creates the learner row
  await makeAdmin("admin@example.com");
  const learner = await signUp(app, "learner@example.com");
  return { admin, learner };
}

test("collections.list: 401 without login; seeded Start here is featured with its path", async () => {
  assert.equal((await q("", "collections.list")).statusCode, 401);
  const { learner } = await setup();
  const list = out(await q(learner, "collections.list"));
  assert.deepEqual(list.map((c: { slug: string }) => c.slug), ["start-here"]);
  assert.deepEqual(list[0].paths.map((p: { slug: string }) => p.slug), ["js-foundations"]);
  assert.equal(list[0].paths[0].enrolled, false);
});

test("only admins can change what is featured", async () => {
  const { admin, learner } = await setup();
  const calls: [string, unknown][] = [
    ["collections.adminList", undefined],
    ["collections.create", { slug: "x", title: "X" }],
    ["collections.setFeatured", { slug: "start-here", featured: false }],
    ["collections.setPaths", { slug: "start-here", pathSlugs: [] }],
  ];
  for (const [path, input] of calls) {
    const res = path === "collections.adminList" ? await q(learner, path) : await m(learner, path, input);
    assert.equal(res.statusCode, 403, path);
    assert.equal(code(res), "FORBIDDEN");
  }
  assert.equal(out(await q(learner, "collections.list")).length, 1); // nothing changed
  assert.equal((await m(admin, "collections.setFeatured", { slug: "start-here", featured: false })).statusCode, 200);
  assert.deepEqual(out(await q(learner, "collections.list")), []);
  assert.equal(out(await q(admin, "collections.adminList"))[0].featured, false);
});

test("admin creates, fills and orders a collection; unfeatured and empty ones stay hidden", async () => {
  const { admin, learner } = await setup();
  await db.insert(paths).values([{ slug: "p-one", title: "One" }, { slug: "p-two", title: "Two" }, { slug: "p-priv", title: "Priv", visibility: "private" }]);
  assert.equal((await m(admin, "collections.create", { slug: "by-topic", title: "By topic", description: "d" })).statusCode, 200);
  assert.equal(code(await m(admin, "collections.create", { slug: "by-topic", title: "again" })), "CONFLICT");
  assert.equal((await m(admin, "collections.setFeatured", { slug: "by-topic", featured: true })).statusCode, 200);
  // Featured but empty: hidden.
  assert.deepEqual(out(await q(learner, "collections.list")).map((c: { slug: string }) => c.slug), ["start-here"]);

  assert.equal(code(await m(admin, "collections.setPaths", { slug: "by-topic", pathSlugs: ["p-priv"] })), "BAD_REQUEST");
  assert.equal(code(await m(admin, "collections.setPaths", { slug: "by-topic", pathSlugs: ["nope"] })), "BAD_REQUEST");
  assert.equal(code(await m(admin, "collections.setPaths", { slug: "missing", pathSlugs: [] })), "NOT_FOUND");
  assert.equal((await m(admin, "collections.setPaths", { slug: "by-topic", pathSlugs: ["p-two", "p-one", "p-two"] })).statusCode, 200);
  const list = out(await q(learner, "collections.list"));
  assert.deepEqual(list.map((c: { slug: string }) => c.slug), ["start-here", "by-topic"]);
  assert.deepEqual(list[1].paths.map((p: { slug: string }) => p.slug), ["p-two", "p-one"]);

  // A path made private later disappears from the collection.
  await db.update(paths).set({ visibility: "private" }).where(eq(paths.slug, "p-two"));
  assert.deepEqual(out(await q(learner, "collections.list"))[1].paths.map((p: { slug: string }) => p.slug), ["p-one"]);
});

test("only the first 12 featured collections are listed, each with all its paths", async () => {
  const { admin, learner } = await setup();
  await db.insert(paths).values([{ slug: "p-a", title: "A" }, { slug: "p-b", title: "B" }]);
  for (let i = 0; i < 13; i++) {
    const slug = `c-${String(i).padStart(2, "0")}`;
    await m(admin, "collections.create", { slug, title: slug });
    await m(admin, "collections.setFeatured", { slug, featured: true });
    await m(admin, "collections.setPaths", { slug, pathSlugs: i === 12 ? ["p-b"] : ["p-a", "p-b"] });
  }
  const list = out(await q(learner, "collections.list"));
  assert.equal(list.length, 12); // start-here (position 0) plus c-00..c-10
  assert.ok(list.every((c: { paths: unknown[] }) => c.paths.length > 0));
  assert.deepEqual(list[1].paths.map((p: { slug: string }) => p.slug), ["p-a", "p-b"]);
});

test("reseeding keeps an admin's edits to the starter collection", async () => {
  const { admin } = await setup();
  await m(admin, "collections.setPaths", { slug: "start-here", pathSlugs: [] });
  const { seed } = await import("../src/db/seed.ts");
  await seed();
  assert.deepEqual(out(await q(admin, "collections.adminList"))[0].pathSlugs, []);
});
