import { code, out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { lessonMedia, lessons, steps, worlds } from "../src/db/schema.ts";
import { memoryStorage, s3Storage, setStorage } from "../src/media/storage.ts";
import { saveMedia } from "../src/media/service.ts";
import { importNarration } from "../src/media/import-narration.ts";

const app = buildApp();
after(() => {
  setStorage(null);
  return app.close();
});

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]); // "ID3" tag
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function lessonVersion() {
  const [row] = await db.select().from(lessons).where(eq(lessons.slug, "lesson-1"));
  return { versionId: row!.currentVersionId!, stepId: "s1" };
}

async function rejects(p: Promise<unknown>, message: string) {
  await assert.rejects(p, (err: unknown) => err instanceof TRPCError && err.message === message, message);
}

test("saveMedia refuses when no storage is configured", async () => {
  await signUp(app);
  const { versionId } = await lessonVersion();
  setStorage(null);
  await rejects(
    saveMedia({ lessonVersionId: versionId, kind: "narration", body: MP3, contentType: "audio/mpeg" }),
    "Media storage is not configured",
  );
});

test("saveMedia rejects bad type, oversize body, mismatched bytes and SVG", async () => {
  await signUp(app);
  const { versionId } = await lessonVersion();
  const mem = memoryStorage();
  setStorage(mem);
  const save = (kind: "narration" | "image", body: Uint8Array, contentType: string) =>
    saveMedia({ lessonVersionId: versionId, kind, body, contentType });

  await rejects(save("image", PNG, "image/gif"), "Unsupported media type");
  await rejects(save("image", SVG, "image/svg+xml"), "Unsupported media type");
  await rejects(save("image", SVG, "image/png"), "Media bytes do not match type");
  await rejects(save("narration", PNG, "audio/mpeg"), "Media bytes do not match type");
  await rejects(save("image", new Uint8Array(2 * 1024 * 1024 + 1).fill(0x89), "image/png"), "Media too large");

  assert.equal(mem.objects.size, 0, "nothing reaches the bucket when a check fails");
  assert.equal((await db.select().from(lessonMedia)).length, 0);
});

test("saveMedia writes the object, then the row, under a server-built key", async () => {
  await signUp(app);
  const { versionId, stepId } = await lessonVersion();
  const mem = memoryStorage();
  setStorage(mem);

  const key = await saveMedia({ lessonVersionId: versionId, stepId, kind: "narration", body: MP3, contentType: "audio/mpeg" });

  assert.match(key, new RegExp(`^v/${versionId}/[0-9a-f-]{36}\\.mp3$`));
  assert.equal(mem.objects.get(key)?.contentType, "audio/mpeg");
  const [row] = await db.select().from(lessonMedia);
  assert.deepEqual(
    { lessonVersionId: row!.lessonVersionId, stepId: row!.stepId, kind: row!.kind, key: row!.key, bytes: row!.bytes },
    { lessonVersionId: versionId, stepId, kind: "narration", key, bytes: MP3.byteLength },
  );
});

test("lessons.get returns signed narration, and no images, for a visible lesson", async () => {
  const cookie = await signUp(app);
  const { versionId, stepId } = await lessonVersion();
  setStorage(memoryStorage());
  const key = await saveMedia({ lessonVersionId: versionId, stepId, kind: "narration", body: MP3, contentType: "audio/mpeg" });
  // Images are signed inline in part.doc by resolveDocImages, so the media list leaves them out.
  await saveMedia({ lessonVersionId: versionId, stepId, kind: "image", body: PNG, contentType: "image/png" });

  const body = out(await trpc(app, cookie).q("lessons.get", { id: "lesson-1" }));
  assert.deepEqual(body.media, [{ stepId, kind: "narration", url: `memory://${key}` }]);
});

test("importNarration stores one MP3 per step and skips steps already stored", async () => {
  await signUp(app);
  const { versionId } = await lessonVersion();
  const mem = memoryStorage();
  setStorage(mem);
  const stepRows = await db.select({ id: steps.id, idx: steps.idx }).from(steps).where(eq(steps.lessonVersionId, versionId)).orderBy(asc(steps.idx));
  const [a, b] = stepRows;

  assert.deepEqual(await importNarration("lesson-1", [{ idx: a!.idx, body: MP3 }]), { saved: [a!.idx], skipped: [] });
  assert.deepEqual(await importNarration("lesson-1", [{ idx: a!.idx, body: MP3 }, { idx: b!.idx, body: MP3 }]), { saved: [b!.idx], skipped: [a!.idx] });

  const rows = await db.select().from(lessonMedia).orderBy(asc(lessonMedia.createdAt));
  assert.deepEqual(rows.map((r) => [r.stepId, r.kind, r.contentType]), [[a!.id, "narration", "audio/mpeg"], [b!.id, "narration", "audio/mpeg"]]);
  assert.equal(mem.objects.size, 2);
});

test("importNarration refuses unknown steps, bad bytes and missing storage before writing", async () => {
  await signUp(app);
  const mem = memoryStorage();
  setStorage(mem);
  await assert.rejects(importNarration("lesson-1", [{ idx: 999, body: MP3 }]), /no step with idx 999/);
  await assert.rejects(importNarration("no-such-lesson", [{ idx: 0, body: MP3 }]), /not found/);
  const [first] = await db.select({ idx: steps.idx }).from(steps).limit(1);
  await rejects(importNarration("lesson-1", [{ idx: first!.idx, body: PNG }]), "Media bytes do not match type");
  setStorage(null);
  await rejects(importNarration("lesson-1", [{ idx: first!.idx, body: MP3 }]), "Media storage is not configured");
  assert.equal(mem.objects.size, 0);
  assert.equal((await db.select().from(lessonMedia)).length, 0);
});

test("lessons.get leaks no media URL for a lesson the caller cannot see", async () => {
  const cookie = await signUp(app);
  const { versionId, stepId } = await lessonVersion();
  setStorage(memoryStorage());
  await saveMedia({ lessonVersionId: versionId, stepId, kind: "narration", body: MP3, contentType: "audio/mpeg" });
  await db.update(worlds).set({ visibility: "private", ownerId: null });

  const res = await trpc(app, cookie).q("lessons.get", { id: "lesson-1" });
  assert.equal(res.statusCode, 404);
  assert.equal(code(res), "NOT_FOUND");
  assert.ok(!res.body.includes("memory://"));
});

test("s3 signing is local, 2h, and pinned to the start of the hour", async () => {
  const store = s3Storage({
    endpoint: "http://127.0.0.1:9000",
    bucket: "lq-media-dev",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    region: "auto",
  });
  const realNow = Date.now;
  try {
    // 10:30 and 10:59 UTC: same hour, so the same signed URL.
    Date.now = () => Date.UTC(2026, 10, 1, 10, 30);
    const a = await store.signGet("v/x/y.mp3");
    Date.now = () => Date.UTC(2026, 10, 1, 10, 59);
    const b = await store.signGet("v/x/y.mp3");
    assert.equal(a, b);

    const url = new URL(a);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "7200");
    assert.equal(url.searchParams.get("X-Amz-Date"), "20261101T100000Z");
    assert.equal(url.pathname, "/lq-media-dev/v/x/y.mp3");

    // The next hour gets a new signature.
    Date.now = () => Date.UTC(2026, 10, 1, 11, 0);
    assert.notEqual(await store.signGet("v/x/y.mp3"), a);
  } finally {
    Date.now = realNow;
  }
});
