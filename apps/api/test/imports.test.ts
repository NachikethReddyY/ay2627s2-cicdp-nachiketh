import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { importJobEvents, importJobs, lessons, lessonVersions, steps, worlds } from "../src/db/schema.ts";
import { parseEnv } from "../src/env.ts";
import { importsIdle, setIngest, subscribe, sweepOrphanedJobs } from "../src/imports/runner.ts";
import type { IngestFn } from "../src/imports/ingest.ts";

const app = buildApp();
after(() => app.close());

const SHA = "a1b2c3d4e5f6";
let n = 0;

// What WP6 will do: a draft lesson from a repo with a version and one step.
const fakeIngest: IngestFn = async (_input, emit) => {
  emit("progress", { step: "fetch" });
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [lesson] = await db
    .insert(lessons)
    .values({ slug: `imported-${++n}-${Date.now()}`, worldId: world!.id, title: "Imported", sourceKind: "repo", status: "draft" })
    .returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1 }).returning();
  await db.insert(steps).values({
    lessonVersionId: version!.id,
    idx: 0,
    public: { title: "Q", prompt: "p", kind: "mcq", options: ["a", "b"] },
    secret: { beforeFiles: {}, hunks: [], answer: 0, hints: [], explanations: { workedExample: "", practice: "" } },
  });
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  emit("progress", { step: "write" });
  return { lessonId: lesson!.id };
};

const post = (cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie, "content-type": "application/json" }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
const startJob = async (cookie: string) => {
  const res = await post(cookie, "/api/lessons/import", { repo: "acme/demo", sha: SHA });
  assert.equal(res.statusCode, 202);
  return res.json().jobId as string;
};
const events = (cookie: string, jobId: string, headers: Record<string, string> = {}, query = "") =>
  app.inject({ method: "GET", url: `/api/jobs/${jobId}/events${query}`, headers: { cookie, ...headers } });
type Frame = { id: number; event: string; data: any };
const frames = (body: string): Frame[] =>
  body
    .split("\n\n")
    .filter(Boolean)
    .map((f) => {
      const get = (k: string) => f.split("\n").find((l) => l.startsWith(`${k}: `))!.slice(k.length + 2);
      return { id: Number(get("id")), event: get("event"), data: JSON.parse(get("data")) };
    });
const finished = async (cookie: string, jobId: string) => {
  await importsIdle();
  return frames((await events(cookie, jobId)).body);
};

test("the default allow-list is empty", () => {
  const base = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "x".repeat(32) };
  const empty = parseEnv(base);
  assert.ok(empty.success && empty.data.IMPORT_REPO_ALLOWLIST.length === 0);
  const some = parseEnv({ ...base, IMPORT_REPO_ALLOWLIST: " Acme/Demo , other/repo " });
  assert.ok(some.success);
  assert.deepEqual(some.data.IMPORT_REPO_ALLOWLIST, ["acme/demo", "other/repo"]);
});

test("import needs a session, a valid body and an allow-listed repo", async () => {
  assert.equal((await post("", "/api/lessons/import", { repo: "acme/demo", sha: SHA })).statusCode, 401);
  const c = await signUp(app);
  for (const body of [undefined, { repo: "acme/demo" }, { repo: "acme/demo", sha: "xyz" }, { repo: "nope", sha: SHA }]) {
    const res = await post(c, "/api/lessons/import", body);
    assert.equal(res.statusCode, 400);
  }
  const res = await post(c, "/api/lessons/import", { repo: "evil/repo", sha: SHA });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error.message, /allow-list/);
  assert.equal((await db.select().from(importJobs)).length, 0);
});

test("happy path: 202, job succeeds with a lesson, events are stored in order", async () => {
  setIngest(fakeIngest);
  const c = await signUp(app);
  const jobId = await startJob(c);
  const got = await finished(c, jobId);
  assert.deepEqual(got.map((f) => f.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(got.map((f) => f.event), ["status", "status", "progress", "progress", "status"]);
  assert.deepEqual(got.map((f) => f.data.status ?? f.data.step), ["queued", "running", "fetch", "write", "succeeded"]);
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  assert.equal(job!.status, "succeeded");
  assert.ok(job!.lessonId);
  assert.equal(got.at(-1)!.data.lessonId, job!.lessonId);
});

test("failing ingest ends the job as failed with the error", async () => {
  setIngest(async () => {
    throw new Error("boom");
  });
  const c = await signUp(app);
  const jobId = await startJob(c);
  const got = await finished(c, jobId);
  assert.deepEqual(got.at(-1), { id: got.length, event: "status", data: { status: "failed", error: "boom" } });
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  assert.equal(job!.status, "failed");
  assert.equal(job!.error, "boom");
});

test("the default ingest fails with the WP6 message", async () => {
  const { defaultIngest } = await import("../src/imports/ingest.ts");
  setIngest(defaultIngest);
  const c = await signUp(app);
  const got = await finished(c, await startJob(c));
  assert.match(got.at(-1)!.data.error, /not available yet \(WP6\)/);
});

test("SSE streams live events to the creator and closes after the terminal one", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  setIngest(async (input, emit) => {
    await gate;
    return fakeIngest(input, emit);
  });
  const c = await signUp(app);
  const jobId = await startJob(c);
  const pending = events(c, jobId);
  await new Promise((r) => setTimeout(r, 50)); // the stream is open and has replayed the early events
  release();
  const res = await pending;
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["content-type"]), /^text\/event-stream/);
  assert.equal(res.headers["cache-control"], "no-cache");
  const got = frames(res.body);
  assert.deepEqual(got.map((f) => f.id), [1, 2, 3, 4, 5]);
  assert.equal(got.at(-1)!.data.status, "succeeded");
});

test("SSE is 404 for another learner and for an unknown job, 401 without a session", async () => {
  setIngest(fakeIngest);
  const a = await signUp(app, "a@example.com");
  const b = await signUp(app, "b@example.com");
  const jobId = await startJob(a);
  await importsIdle();
  assert.equal((await events(b, jobId)).statusCode, 404);
  assert.equal((await events(a, "no-such-job")).statusCode, 404);
  assert.equal((await events("", jobId)).statusCode, 401);
  assert.equal((await events(a, jobId)).statusCode, 200);
});

test("Last-Event-ID and ?after= replay only later events", async () => {
  setIngest(fakeIngest);
  const c = await signUp(app);
  const jobId = await startJob(c);
  await importsIdle();
  const viaHeader = frames((await events(c, jobId, { "last-event-id": "3" })).body);
  assert.deepEqual(viaHeader.map((f) => f.id), [4, 5]);
  const viaQuery = frames((await events(c, jobId, {}, "?after=4")).body);
  assert.deepEqual(viaQuery.map((f) => f.id), [5]);
});

test("publish and unpublish: creator only, learners see it only while published", async () => {
  setIngest(fakeIngest);
  const author = await signUp(app, "author@example.com");
  const other = await signUp(app, "other@example.com");
  const jobId = await startJob(author);
  await importsIdle();
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  const lessonId = job!.lessonId!;
  const [{ slug: courseSlug }] = await db.select({ slug: worlds.slug }).from(worlds).where(eq(worlds.slug, "codequest"));
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  assert.equal(lesson!.sourceKind, "repo");

  // Hidden everywhere while draft: direct read, course list and home.
  const hidden = async () => {
    assert.equal(code(await trpc(app, other).q("lessons.get", { id: lessonId })), "NOT_FOUND");
    assert.equal(code(await trpc(app, author).q("lessons.get", { id: lessonId })), "NOT_FOUND");
    const course = out(await trpc(app, other).q("courses.get", { slug: courseSlug }));
    assert.ok(!course.lessons.some((l: { slug: string }) => l.slug === lesson!.slug));
    assert.ok(!JSON.stringify(out(await trpc(app, other).q("home.get"))).includes(lesson!.slug));
  };
  await hidden();

  assert.equal((await post(other, `/api/lessons/${lessonId}/publish`)).statusCode, 404);
  assert.equal((await post(other, `/api/lessons/${lessonId}/unpublish`)).statusCode, 404);
  assert.equal((await post("", `/api/lessons/${lessonId}/publish`)).statusCode, 401);
  await hidden();

  for (let i = 0; i < 2; i++) {
    const res = await post(author, `/api/lessons/${lessonId}/publish`); // idempotent
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { id: lessonId, status: "published" });
  }
  const [published] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, lesson!.currentVersionId!));
  assert.ok(published!.publishedAt);
  assert.equal((await trpc(app, other).q("lessons.get", { id: lessonId })).statusCode, 200);
  const course = out(await trpc(app, other).q("courses.get", { slug: courseSlug }));
  assert.ok(course.lessons.some((l: { slug: string }) => l.slug === lesson!.slug));

  for (let i = 0; i < 2; i++) {
    const res = await post(author, `/api/lessons/${lessonId}/unpublish`);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { id: lessonId, status: "draft" });
  }
  await hidden();
  const [after] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  assert.equal(after!.currentVersionId, lesson!.currentVersionId); // the version is kept
});

test("publish without a current version is 409; an unknown lesson is 404", async () => {
  setIngest(async () => {
    const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
    const [l] = await db
      .insert(lessons)
      .values({ slug: `empty-${Date.now()}`, worldId: world!.id, title: "Empty", sourceKind: "repo", status: "draft" })
      .returning();
    return { lessonId: l!.id };
  });
  const c = await signUp(app);
  const jobId = await startJob(c);
  await importsIdle();
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  const res = await post(c, `/api/lessons/${job!.lessonId}/publish`);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, "conflict");
  assert.equal((await post(c, "/api/lessons/nope/publish")).statusCode, 404);
});

test("a cursor at the terminal seq closes the stream immediately", async () => {
  setIngest(fakeIngest);
  const c = await signUp(app);
  const jobId = await startJob(c);
  await importsIdle();
  const res = await Promise.race([
    events(c, jobId, { "last-event-id": "5" }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("stream hung")), 3000)),
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "");
});

test("sweepOrphanedJobs fails jobs left queued or running", async () => {
  const c = await signUp(app, "sweep@example.com");
  setIngest(fakeIngest);
  const first = await startJob(c); // creates the learner row
  await importsIdle();
  const [owner] = await db.select({ createdBy: importJobs.createdBy }).from(importJobs).where(eq(importJobs.id, first));
  const [job] = await db.insert(importJobs).values({ createdBy: owner!.createdBy, repo: "acme/demo", sha: SHA, status: "running" }).returning();
  assert.ok((await sweepOrphanedJobs()) >= 1);
  const [after] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id));
  assert.equal(after!.status, "failed");
  assert.equal(after!.error, "interrupted by restart");
  const got = frames((await events(c, job!.id)).body);
  assert.deepEqual(got.at(-1)!.data, { status: "failed", error: "interrupted by restart" });
  assert.equal((await db.select().from(importJobEvents).where(eq(importJobEvents.jobId, job!.id))).length, 1);
});

test("a throwing subscriber and a late emit do not affect the job", async () => {
  let late!: (k: string, d: unknown) => void;
  setIngest(async (input, emit) => {
    late = emit;
    return fakeIngest(input, emit);
  });
  const c = await signUp(app);
  const jobId = await startJob(c);
  const off = subscribe(jobId, () => {
    throw new Error("bad subscriber");
  });
  await importsIdle();
  off();
  late("progress", { step: "too-late" });
  await new Promise((r) => setTimeout(r, 50));
  const got = frames((await events(c, jobId)).body);
  assert.equal(got.at(-1)!.data.status, "succeeded");
  assert.ok(!got.some((f) => f.data.step === "too-late"));
});

test("publish and unpublish are 409 for an archived lesson", async () => {
  setIngest(fakeIngest);
  const c = await signUp(app);
  const jobId = await startJob(c);
  await importsIdle();
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
  await db.update(lessons).set({ status: "archived" }).where(eq(lessons.id, job!.lessonId!));
  for (const action of ["publish", "unpublish"]) {
    const res = await post(c, `/api/lessons/${job!.lessonId}/${action}`);
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, "conflict");
  }
  const [l] = await db.select().from(lessons).where(eq(lessons.id, job!.lessonId!));
  assert.equal(l!.status, "archived");
});
