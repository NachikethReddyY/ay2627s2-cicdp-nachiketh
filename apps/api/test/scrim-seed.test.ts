import "./helpers.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { attempts, hintEvents, lessonMedia, learners, lessons, lessonVersions, stepProgress, steps, user, worlds } from "../src/db/schema.ts";
import { seed } from "../src/db/seed.ts";
import { silentWav } from "../src/media/silent-wav.ts";
import { memoryStorage, setStorage } from "../src/media/storage.ts";
import { LessonFile } from "../src/db/lesson-file.ts";
import { parseScrim } from "../src/parts/scrim-schema.ts";

const SLUG = "scrim-return-values";

async function scrimVersionId() {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.slug, SLUG));
  return { lesson: lesson!, versionId: lesson!.currentVersionId! };
}

test("seed adds the scrim demo as a published scrim lesson", async () => {
  await seed();
  const { lesson, versionId } = await scrimVersionId();
  assert.equal(lesson.kind, "scrim");
  assert.equal(lesson.status, "published");
  const [world] = await db.select().from(worlds).where(eq(worlds.id, lesson.worldId));
  assert.equal(world!.slug, "scrim-demo");

  const [version] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, versionId));
  const scrim = parseScrim(version!.content);
  assert.ok(scrim, "the version holds a valid scrim part");
  assert.equal(scrim.language, "javascript");
  assert.equal(scrim.segments.length, 4);
  assert.ok(scrim.segments.every((s) => s.durationMs === 3000));
  assert.equal(scrim.segments.filter((s) => s.edit).length, 3);
  assert.equal(scrim.segments.filter((s) => s.edit?.run).length, 2);
});

test("the gate on segment 1 resolves to the one step, which is an mcq", async () => {
  await seed();
  const { lesson, versionId } = await scrimVersionId();
  const [version] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, versionId));
  const scrim = parseScrim(version!.content)!;
  const gates = scrim.segments.flatMap((s, segment) => (s.gate === undefined ? [] : [{ segment, gate: s.gate }]));
  assert.deepEqual(gates, [{ segment: 1, gate: 0 }]);

  const rows = await db.select().from(steps).where(eq(steps.lessonVersionId, versionId)).orderBy(asc(steps.idx));
  assert.deepEqual(rows.map((r) => r.idx), [0]);
  const gated = rows.find((r) => r.idx === gates[0]!.gate);
  assert.equal(gated?.public.kind, "mcq");
  assert.equal(gated?.public.options?.length, 3);
  assert.equal(lesson.kind, "scrim");
});

test("the lab has two sample tests and two hidden tests", async () => {
  await seed();
  const { versionId } = await scrimVersionId();
  const [version] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, versionId));
  const lab = parseScrim(version!.content)!.lab;
  assert.equal(lab.kind, "practice");
  assert.equal(lab.language, "javascript");
  const tests = lab.tests ?? [];
  assert.equal(tests.filter((t) => t.visibility === "sample").length, 2);
  assert.equal(tests.filter((t) => t.visibility === "hidden").length, 2);
});

test("an authored scrim lesson must gate every step it defines", async () => {
  const file = JSON.parse(await readFile(new URL("../../../worlds/scrim-demo/lessons/scrim-return-values.json", import.meta.url), "utf8"));
  assert.ok(LessonFile.safeParse(file).success);
  const extra = { ...file, steps: [...file.steps, structuredClone(file.steps[0])] };
  const result = LessonFile.safeParse(extra);
  assert.ok(!result.success);
  assert.match(JSON.stringify(result.error.issues), /step 1 has no gate segment in the scrim/);
});

test("seeding twice keeps one scrim lesson, one step and one narration per segment", async () => {
  const mem = memoryStorage();
  setStorage(mem);
  try {
    await seed();
    await seed();
    const { versionId } = await scrimVersionId();
    assert.equal((await db.select().from(lessons).where(eq(lessons.slug, SLUG))).length, 1);
    assert.equal((await db.select().from(steps).where(eq(steps.lessonVersionId, versionId))).length, 1);
    const narration = await db
      .select()
      .from(lessonMedia)
      .where(and(eq(lessonMedia.lessonVersionId, versionId), eq(lessonMedia.kind, "narration")));
    assert.deepEqual(narration.map((r) => r.segment).sort(), [0, 1, 2, 3]);
    assert.ok(narration.every((r) => r.contentType === "audio/wav" && r.stepId === null && r.status === "ready"));
    assert.equal(mem.objects.size, 4);
  } finally {
    setStorage(null);
  }
});

test("seed without media storage adds the lesson and no narration", async () => {
  setStorage(null);
  await seed();
  const { versionId } = await scrimVersionId();
  assert.equal((await db.select().from(lessonMedia).where(eq(lessonMedia.lessonVersionId, versionId))).length, 0);
  assert.equal((await scrimVersionId()).lesson.kind, "scrim");
});

test("silentWav is a valid 8 kHz mono 16-bit RIFF/WAVE file of the requested length", () => {
  const bytes = silentWav(300);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => new TextDecoder().decode(bytes.subarray(at, at + 4));
  assert.equal(text(0), "RIFF");
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(text(8), "WAVE");
  assert.equal(text(12), "fmt ");
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 8000, "sample rate");
  assert.equal(view.getUint32(28, true), 16000, "byte rate");
  assert.equal(view.getUint16(32, true), 2, "block align");
  assert.equal(view.getUint16(34, true), 16, "bits per sample");
  assert.equal(text(36), "data");
  assert.equal(view.getUint32(40, true), 4800);
  assert.equal(bytes.byteLength, 44 + 4800);
  assert.ok(bytes.subarray(44).every((b) => b === 0), "silent");
});

test("reseeding after a removed gate keeps the learner's attempts, hints and progress", async () => {
  await seed();
  const { versionId } = await scrimVersionId();
  const [gated] = await db.select().from(steps).where(eq(steps.lessonVersionId, versionId));
  const [ghost] = await db.insert(steps).values({ ...gated!, id: "scrim-return-values-removed-gate", idx: 9 }).returning();
  const [authUser] = await db.insert(user).values({ id: "lq112-reseed", name: "Reseed", email: "lq112-reseed@example.com" }).returning();
  const learnerId = (await db.insert(learners).values({ userId: authUser.id }).returning({ id: learners.id }))[0]!.id;
  await db.insert(attempts).values({ learnerId, stepId: ghost!.id, kind: "mcq", response: { option: 0 }, observed: true, correct: true, hintsUsed: 1 });
  await db.insert(hintEvents).values({ learnerId, stepId: ghost!.id, rung: 1 });
  await db.insert(stepProgress).values({ learnerId, stepId: ghost!.id, state: "hinting" });
  await seed();
  assert.equal((await db.select().from(attempts).where(eq(attempts.stepId, ghost!.id))).length, 1);
  assert.equal((await db.select().from(hintEvents).where(eq(hintEvents.stepId, ghost!.id))).length, 1);
  assert.equal((await db.select().from(stepProgress).where(eq(stepProgress.stepId, ghost!.id))).length, 1);
  assert.equal((await db.select().from(steps).where(eq(steps.id, ghost!.id))).length, 1);
});
