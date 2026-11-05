// Live check of the media path against a real bucket (LQ-47). Skipped unless S3_LIVE=1, so CI never calls out.
// Run against staging: S3_LIVE=1 S3_ENDPOINT=... S3_BUCKET=lq-media-staging S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
//   node --test test/media.live.test.ts
import { out, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { saveMedia } from "../src/media/service.ts";
import { importNarration } from "../src/media/import-narration.ts";
import { db } from "../src/db/client.ts";
import { lessons, steps } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";

const live = process.env.S3_LIVE === "1" && !!env.S3_BUCKET;
const skip = live ? false : "set S3_LIVE=1 and the S3_* variables to run";

// 1x1 PNG, and one silent MPEG-1 Layer III frame (128 kbps, 44.1 kHz).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const MP3 = new Uint8Array(417).fill(0);
MP3.set([0xff, 0xfb, 0x90, 0x64]);

const client = live
  ? new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    })
  : null;
const app = buildApp();
const written: string[] = [];
after(async () => {
  for (const Key of written) await client?.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key }));
  await app.close();
});

test("real bucket: objects carry their type and cache headers, signed URLs work, bad URLs are refused", { skip }, async () => {
  const cookie = await signUp(app);
  const [lesson] = await db.select().from(lessons).where(eq(lessons.slug, "lesson-1"));
  const versionId = lesson!.currentVersionId!;
  const [first] = await db.select({ idx: steps.idx }).from(steps).where(eq(steps.lessonVersionId, versionId)).limit(1);

  // Narration through the import command, an image straight through saveMedia.
  const r = await importNarration("lesson-1", [{ idx: first!.idx, body: MP3 }]);
  assert.deepEqual(r.saved, [first!.idx]);
  const pngKey = await saveMedia({ lessonVersionId: versionId, kind: "image", body: PNG, contentType: "image/png" });
  written.push(pngKey);

  const body = out(await trpc(app, cookie).q("lessons.get", { id: "lesson-1" }));
  assert.equal(body.media.length, 1);
  const audioUrl: string = body.media[0].url;
  const mp3Key = decodeURIComponent(new URL(audioUrl).pathname.split("/").slice(2).join("/"));
  written.push(mp3Key);

  for (const [Key, type] of [[mp3Key, "audio/mpeg"], [pngKey, "image/png"]] as const) {
    const head = await client!.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key }));
    assert.equal(head.ContentType, type, Key);
    assert.equal(head.CacheControl, "private, max-age=31536000, immutable", Key);
  }

  const ok = await fetch(audioUrl);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "audio/mpeg");
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), MP3);

  const tampered = new URL(audioUrl);
  const sig = tampered.searchParams.get("X-Amz-Signature")!;
  tampered.searchParams.set("X-Amz-Signature", (sig[0] === "0" ? "1" : "0") + sig.slice(1));
  assert.equal((await fetch(tampered)).status, 403, "tampered signature");

  const expired = await getSignedUrl(client!, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: pngKey }), {
    expiresIn: 60,
    signingDate: new Date(Date.now() - 3600_000),
  });
  assert.equal((await fetch(expired)).status, 403, "expired URL");
});
