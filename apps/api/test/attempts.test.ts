import { out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { attempts } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

const FORBIDDEN = ["secret", "answer", "accepted", "hunks", "explanations", "narration", "source"];
function walk(v: unknown, path = "") {
  if (Array.isArray(v)) return v.forEach((x) => walk(x, path));
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      assert.ok(!FORBIDDEN.includes(k), `leaked key ${k}`);
      walk(x, `${path}.${k}`);
    }
  }
}

const get = (c: string, id: string) => trpc(app, c).q("steps.get", { id });
const reveal = (c: string, id: string) => trpc(app, c).q("steps.reveal", { id });
const hint = (c: string, id: string) => trpc(app, c).m("steps.hint", { id });
const skip = (c: string, id: string) => trpc(app, c).m("steps.skip", { id });
const attempt = (c: string, id: string, answer: object) => trpc(app, c).m("steps.attempt", { id, answer });
const mcq = (c: string, choice: number) => attempt(c, "s1", { kind: "mcq", choice });
// s1 answer is index 1.

test("401 without login", async () => {
  const t = trpc(app);
  for (const res of [
    await t.q("steps.get", { id: "s1" }),
    await t.m("steps.attempt", { id: "s1", answer: { kind: "mcq", choice: 0 } }),
    await t.m("steps.hint", { id: "s1" }),
    await t.m("steps.skip", { id: "s1" }),
    await t.q("steps.reveal", { id: "s1" }),
  ]) assert.equal(res.statusCode, 401);
});

test("full MCQ path ends revealed after a failed retry", async () => {
  const c = await signUp(app);
  const first = out(await get(c, "s1"));
  assert.equal(first.kind, "mcq");
  assert.equal(first.options.length, 4);
  assert.deepEqual(first.hints, []);
  assert.equal((await reveal(c, "s1")).statusCode, 409);

  let r = out(await mcq(c, 0));
  assert.deepEqual([r.correct, r.state, r.attemptAllowed, r.hintsUsed, r.feedback], [false, "hinting", false, 0, "Not quite."]);
  assert.equal((await mcq(c, 0)).statusCode, 409);

  let h = out(await hint(c, "s1"));
  assert.equal(h.rung, 1);
  assert.equal(h.eliminate, 3);
  walk(h);
  r = out(await mcq(c, 0));
  assert.deepEqual([r.state, r.attemptAllowed, r.hintsUsed], ["hinting", false, 1]);

  h = out(await hint(c, "s1"));
  assert.equal(h.rung, 2);
  assert.equal("eliminate" in h, false);
  walk(h);
  assert.equal((await hint(c, "s1")).statusCode, 409);

  const mid = out(await get(c, "s1"));
  walk(mid);
  assert.equal(mid.hints.length, 2);
  assert.equal(mid.rungsTaken, 2);

  r = out(await mcq(c, 2));
  assert.deepEqual([r.state, r.attemptAllowed], ["hinting", true]); // retry offered
  r = out(await mcq(c, 2));
  assert.equal(r.state, "revealed");
  assert.equal((await mcq(c, 1)).statusCode, 409);

  const rev = await reveal(c, "s1");
  assert.equal(rev.statusCode, 200);
  assert.deepEqual(out(rev).answer, { type: "mcq", index: 1 });
  assert.equal(out(rev).explanations.inferred, true);
  assert.equal(out(rev).narration, out(rev).explanations.workedExample); // no own narration: falls back

  const rows = await db.select().from(attempts).where(eq(attempts.stepId, "s1"));
  assert.equal(rows.filter((x) => x.observed).length, 1);
  assert.equal(rows.length, 4);
});

test("correct first try", async () => {
  const c = await signUp(app);
  const r = out(await mcq(c, 1));
  assert.deepEqual([r.correct, r.state, r.feedback, r.hintsUsed], [true, "revealed", "Correct!", 0]);
  assert.equal((await reveal(c, "s1")).statusCode, 200);
  assert.equal((await skip(c, "s1")).statusCode, 409);
});

test("skip, then reveal", async () => {
  const c = await signUp(app);
  assert.equal((await reveal(c, "s1")).statusCode, 409);
  const res = await skip(c, "s1");
  assert.deepEqual(out(res), { state: "skipped" });
  assert.equal((await reveal(c, "s1")).statusCode, 200);
  const [row] = await db.select().from(attempts).where(eq(attempts.stepId, "s1"));
  assert.deepEqual([row!.kind, row!.correct, row!.observed], ["skip", null, true]);
});

test("cloze grading and body validation", async () => {
  const c = await signUp(app);
  assert.equal((await attempt(c, "s2", { kind: "mcq", choice: 0 })).statusCode, 400);
  assert.equal((await attempt(c, "s1", { kind: "cloze", text: "x" })).statusCode, 400);
  assert.equal((await attempt(c, "s2", { kind: "cloze", text: "x".repeat(201) })).statusCode, 400);
  assert.equal((await attempt(c, "s1", { kind: "mcq", choice: 4 })).statusCode, 400);
  const r = out(await attempt(c, "s2", { kind: "cloze", text: " discount=0 " }));
  assert.equal(r.correct, true);
  assert.deepEqual(out(await reveal(c, "s2")).answer, { type: "cloze", text: "discount = 0" });
});

test("unknown step is 404", async () => {
  const c = await signUp(app);
  assert.equal((await get(c, "nope")).statusCode, 404);
});

test("20 parallel identical attempts yield one observed row", async () => {
  const c = await signUp(app);
  const res = await Promise.all(Array.from({ length: 20 }, () => mcq(c, 0)));
  assert.equal(res.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(res.filter((r) => r.statusCode === 409).length, 19);
  const rows = await db.select().from(attempts).where(and(eq(attempts.stepId, "s1"), eq(attempts.observed, true)));
  assert.equal(rows.length, 1);
});

test("a second learner's progress is independent", async () => {
  const a = await signUp(app, "a@example.com");
  const b = await signUp(app, "b@example.com");
  await mcq(a, 1);
  assert.equal(out(await get(a, "s1")).state, "revealed");
  assert.equal(out(await get(b, "s1")).state, "predicting");
  assert.equal((await reveal(b, "s1")).statusCode, 409);
  assert.equal(out(await mcq(b, 0)).state, "hinting");
});

test("leak walk on a fresh step", async () => {
  const c = await signUp(app);
  for (const id of ["s1", "s2", "s3"]) walk((await get(c, id)).json());
});

test("malformed step id is 400, not 500", async () => {
  const c = await signUp(app);
  assert.equal((await get(c, "%00")).statusCode, 400);
});

test("auth runs before validation: no cookie + bad body is 401", async () => {
  const res = await trpc(app).m("steps.attempt", { id: "s1", answer: { kind: "x" } });
  assert.equal(res.statusCode, 401);
});

test("batched mutation with no input (what httpBatchLink sends) is accepted", async () => {
  const c = await signUp(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/trpc/me.update?batch=1",
    headers: { cookie: c, "content-type": "application/json" },
    payload: "{}",
  });
  assert.equal(res.statusCode, 200, res.body);
});

// shortcut: tRPC's Fastify plugin replaces our strict JSON parser, so __proto__ is no longer a 400; it is parsed
// as a plain own key and zod strips it. Upgrade if a handler ever spreads raw input.
test("JSON with a __proto__ key is neutralised", async () => {
  const c = await signUp(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/trpc/steps.attempt",
    headers: { cookie: c, "content-type": "application/json" },
    payload: '{"id":"s1","answer":{"kind":"mcq","choice":1,"__proto__":{"polluted":1}}}',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("a step of a superseded lesson version is not playable", async () => {
  const { lessons, lessonVersions, steps } = await import("../src/db/schema.ts");
  const c = await signUp(app);
  const [lesson] = await db.select().from(lessons).where(eq(lessons.slug, "lesson-1"));
  const [old] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 99, content: null }).returning();
  const [stale] = await db
    .insert(steps)
    .values({
      lessonVersionId: old!.id,
      idx: 0,
      public: { title: "old", prompt: "old", kind: "mcq", options: ["a", "b"] },
      secret: { beforeFiles: {}, hunks: [], answer: 0, hints: [], explanations: { workedExample: "", practice: "" } },
    })
    .returning();
  // lesson.current_version_id still points at the seeded version, so the new version's step is not current.
  assert.equal((await get(c, stale!.id)).statusCode, 404);
  assert.equal((await attempt(c, stale!.id, { kind: "mcq", choice: 0 })).statusCode, 404);
  assert.equal((await get(c, "s1")).statusCode, 200);
});

test("mcq choice is validated against the step's option count", async () => {
  const { lessons, lessonVersions, steps } = await import("../src/db/schema.ts");
  const c = await signUp(app);
  const [lesson] = await db.select().from(lessons).where(eq(lessons.slug, "lesson-1"));
  const [v] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, lesson!.currentVersionId!));
  const [two] = await db
    .insert(steps)
    .values({
      lessonVersionId: v!.id,
      idx: 50,
      public: { title: "two", prompt: "two", kind: "mcq", options: ["a", "b"] },
      secret: { beforeFiles: {}, hunks: [], answer: 1, hints: [], explanations: { workedExample: "", practice: "" } },
    })
    .returning();
  assert.equal((await attempt(c, two!.id, { kind: "mcq", choice: 2 })).statusCode, 400);
  assert.equal((await attempt(c, two!.id, { kind: "mcq", choice: 3 })).statusCode, 400);
  const r = out(await attempt(c, two!.id, { kind: "mcq", choice: 0 }));
  assert.equal(r.correct, false);
  // No hints on this step: the wrong answer leaves a retry instead of a dead end.
  assert.equal(r.attemptAllowed, true);
  assert.equal(out(await attempt(c, two!.id, { kind: "mcq", choice: 1 })).correct, true);
});
