import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/client.ts";
import { lessonMedia } from "../db/schema.ts";
import { storage } from "./storage.ts";

type MediaKind = "narration" | "image";

const MiB = 1024 * 1024;
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

const KINDS: Record<MediaKind, { maxBytes: number; types: Record<string, { ext: string; magic: (b: Uint8Array) => boolean }> }> = {
  narration: {
    maxBytes: 10 * MiB,
    types: {
      "audio/wav": { ext: "wav", magic: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x41, 0x56, 0x45], 8) },
      "audio/mpeg": {
        ext: "mp3",
        magic: (b) => starts(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
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

export type MediaInput = {
  lessonVersionId: string;
  stepId?: string;
  segment?: number;
  kind: MediaKind;
  body: Uint8Array;
  contentType: string;
  promptHash?: string;
};

export async function storeMedia(input: MediaInput, signal?: AbortSignal): Promise<string> {
  if (!storage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Media storage is not configured" });
  const spec = KINDS[input.kind];
  const type = Object.hasOwn(spec.types, input.contentType) ? spec.types[input.contentType] : undefined;
  if (!type) throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported media type" });
  if (input.body.byteLength > spec.maxBytes) throw new TRPCError({ code: "BAD_REQUEST", message: "Media too large" });
  if (!type.magic(input.body)) throw new TRPCError({ code: "BAD_REQUEST", message: "Media bytes do not match type" });

  const key = `v/${input.lessonVersionId}/${randomUUID()}.${type.ext}`;
  await storage.put(key, input.body, input.contentType, signal && { signal });
  return key;
}

export function mediaRow(input: MediaInput, key: string) {
  return {
    lessonVersionId: input.lessonVersionId,
    stepId: input.stepId ?? null,
    segment: input.segment ?? null,
    kind: input.kind,
    promptHash: input.promptHash,
    key,
    contentType: input.contentType,
    bytes: input.body.byteLength,
  };
}

export async function saveMedia(input: MediaInput) {
  const key = await storeMedia(input);
  await db.insert(lessonMedia).values(mediaRow(input, key));
  return key;
}

export async function listMedia(lessonVersionId: string) {
  const s = storage;
  if (!s) return [];
  const rows = await db
    .select({ stepId: lessonMedia.stepId, segment: lessonMedia.segment, key: lessonMedia.key, status: lessonMedia.status })
    .from(lessonMedia)
    .where(and(eq(lessonMedia.lessonVersionId, lessonVersionId), eq(lessonMedia.kind, "narration")))
    .orderBy(asc(lessonMedia.createdAt));
  return Promise.all(rows.filter((r): r is typeof r & { key: string } => r.key !== null && r.status === "ready").map(async (r) => ({ stepId: r.stepId, segment: r.segment, kind: "narration" as const, url: await s.signGet(r.key) })));
}
