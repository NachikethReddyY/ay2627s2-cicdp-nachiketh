import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, pool } from "../db/client.ts";
import { lessonMedia, lessons, steps } from "../db/schema.ts";
import { mediaRow, saveMedia, storeMedia, type MediaInput } from "./service.ts";
import { storage } from "./storage.ts";

type NarrationFile = { idx: number; body: Uint8Array };

/**
 * Stores one narration MP3 per step of a lesson's current version.
 * Safe to rerun: a step that already has ready narration for this version is skipped.
 * With `replace`, a step's old ready narration is marked failed (superseded) and the new file is stored instead.
 */
export async function importNarration(slug: string, files: NarrationFile[], { replace = false }: { replace?: boolean } = {}) {
  if (!storage) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Media storage is not configured" });
  const [lesson] = await db.select({ versionId: lessons.currentVersionId }).from(lessons).where(eq(lessons.slug, slug));
  if (!lesson?.versionId) throw new Error(`Lesson ${slug} not found or has no current version`);
  const versionId = lesson.versionId;

  const rows = await db.select({ id: steps.id, idx: steps.idx }).from(steps).where(eq(steps.lessonVersionId, versionId));
  const byIdx = new Map(rows.map((r) => [r.idx, r.id]));
  const unknown = files.filter((f) => !byIdx.has(f.idx)).map((f) => f.idx);
  if (unknown.length) throw new Error(`Lesson ${slug} has no step with idx ${unknown.join(", ")}`);
  // `1.mp3` and `01.mp3` both mean step 1; refuse before writing rather than store two narrations for it.
  const dupes = [...new Set(files.map((f) => f.idx).filter((idx, i, all) => all.indexOf(idx) !== i))];
  if (dupes.length) throw new Error(`More than one file for step idx ${dupes.join(", ")}`);

  const done = await db
    .select({ stepId: lessonMedia.stepId })
    .from(lessonMedia)
    .where(and(eq(lessonMedia.lessonVersionId, versionId), eq(lessonMedia.kind, "narration"), eq(lessonMedia.status, "ready")));
  const have = new Set(done.map((d) => d.stepId));

  const saved: number[] = [];
  const skipped: number[] = [];
  for (const f of files) {
    const stepId = byIdx.get(f.idx)!;
    if (have.has(stepId) && !replace) {
      skipped.push(f.idx);
      continue;
    }
    try {
      const input = { lessonVersionId: versionId, stepId, kind: "narration" as const, body: f.body, contentType: "audio/mpeg" };
      if (have.has(stepId)) await replaceNarration(input);
      else await saveMedia(input);
    } catch (e) {
      // Another import stored this step first (lesson_media_one_narration). Its object is kept; ours is a harmless orphan.
      if (isUniqueViolation(e)) {
        skipped.push(f.idx);
        continue;
      }
      throw e;
    }
    saved.push(f.idx);
  }
  return { saved, skipped };
}

/**
 * Replaces a step's ready narration. The new object is validated and written first, so a rejected file
 * leaves the old row ready. Then the old row is marked failed and the new row inserted in one transaction,
 * so the step never has zero ready rows or two. lesson_media has no "superseded" status, so the old
 * object is left in storage.
 */
async function replaceNarration(input: MediaInput) {
  const key = await storeMedia(input);
  await db.transaction(async (tx) => {
    await tx
      .update(lessonMedia)
      .set({ status: "failed" })
      .where(and(eq(lessonMedia.lessonVersionId, input.lessonVersionId), eq(lessonMedia.stepId, input.stepId!), eq(lessonMedia.kind, "narration"), eq(lessonMedia.status, "ready")));
    await tx.insert(lessonMedia).values(mediaRow(input, key));
  });
}

// drizzle wraps the pg error, so the code can be on the error or its cause.
const isUniqueViolation = (e: unknown) =>
  [e, (e as { cause?: unknown })?.cause].some((x) => (x as { code?: string } | undefined)?.code === "23505");

/** Reads `<step idx>.mp3` files from a folder. Other files are ignored. */
async function readNarrationDir(dir: string): Promise<NarrationFile[]> {
  const names = (await readdir(dir)).filter((n) => /^\d+\.mp3$/.test(n));
  return Promise.all(names.map(async (n) => ({ idx: Number(n.slice(0, -4)), body: new Uint8Array(await readFile(join(dir, n))) })));
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { lesson: { type: "string" }, dir: { type: "string" }, replace: { type: "boolean", default: false } } });
  if (!values.lesson || !values.dir) {
    console.error("usage: pnpm media:narration --lesson <slug> --dir <absolute folder of <idx>.mp3 files> [--replace]");
    process.exitCode = 1;
  } else {
    try {
      const r = await importNarration(values.lesson, await readNarrationDir(values.dir), { replace: values.replace });
      console.log(`saved steps [${r.saved.join(", ")}], skipped (already stored) [${r.skipped.join(", ")}]`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  }
  await pool.end();
}
