import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client.ts";
import { lessonMedia } from "../db/schema.ts";
import { storage } from "./storage.ts";

export type MediaKind = "narration" | "image";

const MiB = 1024 * 1024;
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

// Allowlist per kind. Magic bytes must match the claimed type: AI output is untrusted, and no SVG (it can carry script).
const KINDS: Record<MediaKind, { maxBytes: number; types: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> }> = {
  narration: {
    maxBytes: 10 * MiB,
    types: {
      "audio/mpeg": {
        ext: "mp3",
        magic: (b) => starts(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0),
      },
    },
  },
  image: {
    maxBytes: 2 * MiB,
    types: {
      "image/png": { ext: "png", magic: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]) },
      "image/webp": { ext: "webp", magic: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8) },
      "image/jpeg": { ext: "jpg", magic: (b) => starts(b, [0xff, 0xd8, 0xff]) },
    },
  },
};

// The server generates the bytes, so the browser never uploads and no presigned write URL exists.
export async function saveMedia(input: {
  lessonVersionId: string;
  stepId?: string;
  kind: MediaKind;
  body: Uint8Array;
  contentType: string;
}) {
  if (!storage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Media storage is not configured" });
  const spec = KINDS[input.kind];
  const type = Object.hasOwn(spec.types, input.contentType) ? spec.types[input.contentType] : undefined;
  if (!type) throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported media type" });
  if (input.body.byteLength > spec.maxBytes) throw new TRPCError({ code: "BAD_REQUEST", message: "Media too large" });
  if (!type.magic(input.body)) throw new TRPCError({ code: "BAD_REQUEST", message: "Media bytes do not match type" });

  // Key built here, never from input: no traversal, no overwrite, and the UUID makes it immutable.
  const key = `v/${input.lessonVersionId}/${randomUUID()}.${type.ext}`;
  await storage.put(key, input.body, input.contentType);
  // Object first, row second: a failed insert leaves a harmless orphan object, never a row with nothing behind it.
  await db.insert(lessonMedia).values({
    lessonVersionId: input.lessonVersionId,
    stepId: input.stepId ?? null,
    kind: input.kind,
    key,
    contentType: input.contentType,
    bytes: input.body.byteLength,
  });
  return key;
}

// Signed read URLs for a version's media. Access control is the caller's visibility check (lessons.get).
export async function listMedia(lessonVersionId: string) {
  const s = storage;
  if (!s) return [];
  const rows = await db
    .select({ stepId: lessonMedia.stepId, kind: lessonMedia.kind, key: lessonMedia.key })
    .from(lessonMedia)
    .where(eq(lessonMedia.lessonVersionId, lessonVersionId))
    .orderBy(asc(lessonMedia.createdAt));
  return Promise.all(rows.map(async (r) => ({ stepId: r.stepId, kind: r.kind, url: await s.signGet(r.key) })));
}
