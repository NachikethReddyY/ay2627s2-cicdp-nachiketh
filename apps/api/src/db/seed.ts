import { and, eq, sql } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { saveMedia } from "../media/service.ts";
import { silentWav } from "../media/silent-wav.ts";
import { storage } from "../media/storage.ts";
import { slugOf } from "../progress/mastery.ts";
import { db, pool } from "./client.ts";
import { assertHunksApply, assertUniqueAcrossFiles, LessonFile, Manifest } from "./lesson-file.ts";
import { attempts, hintEvents, stepProgress, concepts, lessonMedia, lessons, lessonVersions, pathCourses, paths, steps, worlds } from "./schema.ts";

const WORLDS_DIR = join(import.meta.dirname, "../../../../worlds");

const SAMPLE_WORLDS = ["variables", "loops"];
const SCRIM_PLACEHOLDER_MS = 300;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function loadWorld(world: string) {
  const manifest = Manifest.parse(await readJson(join(WORLDS_DIR, world, "manifest.json")));
  const dir = join(WORLDS_DIR, world, "lessons");
  const names = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const files = await Promise.all(
    names.map(async (n) => {
      const parsed = LessonFile.safeParse(await readJson(join(dir, n)));
      if (!parsed.success) throw new Error(`${world}/lessons/${n}: ${parsed.error.message}`);
      return parsed.data;
    }),
  );
  assertUniqueAcrossFiles(files);
  files.forEach(assertHunksApply);
  for (const c of manifest.concepts)
    if (c.slug !== slugOf(c.name)) throw new Error(`manifest concept "${c.name}": slug must be "${slugOf(c.name)}"`);
  const known = new Set(manifest.concepts.map((c) => c.name));
  for (const f of files) {
    const missing = f.concepts.filter((c) => !known.has(c));
    if (missing.length) throw new Error(`${f.slug}: concepts not in the manifest: ${missing.join(", ")}`);
  }
  return { manifest, files };
}

type Loaded = Awaited<ReturnType<typeof loadWorld>>;

async function seedSteps(tx: Tx, versionId: string, file: LessonFile) {
  const desired = file.steps.map((step, idx) => ({
    id: step.id ?? `${file.slug}-${idx}`,
    lessonVersionId: versionId,
    idx,
    public: step.public,
    secret: step.secret,
  }));
  const positions = new Map(desired.map(({ id, idx }) => [id, idx]));
  const existing = await tx.select({ id: steps.id, idx: steps.idx }).from(steps)
    .where(eq(steps.lessonVersionId, versionId)).for("update");
  const originalPositions = new Map(existing.map(({ id, idx }) => [id, idx]));
  let archiveIndex = Math.min(0, ...existing.map(({ idx }) => idx)) - 1;
  for (const { id, idx } of existing) {
    const position = positions.get(id);
    if (position === undefined) {
      const removed = await tx.delete(steps).where(and(
        eq(steps.id, id),
        sql`not exists (select 1 from ${attempts} where ${attempts.stepId} = ${id})`,
        sql`not exists (select 1 from ${hintEvents} where ${hintEvents.stepId} = ${id})`,
        sql`not exists (select 1 from ${stepProgress} where ${stepProgress.stepId} = ${id})`,
        sql`not exists (select 1 from ${lessonMedia} where ${lessonMedia.stepId} = ${id})`,
      )).returning({ id: steps.id });
      if (removed.length) continue;
    }
    if (idx >= 0 && position !== idx) {
      await tx.update(steps).set({ idx: archiveIndex-- }).where(eq(steps.id, id));
    }
  }

  for (const row of desired) {
    const oldIndex = originalPositions.get(row.id);
    if (oldIndex !== undefined && oldIndex !== row.idx) {
      await tx.update(steps).set({ idx: row.idx, public: row.public, secret: row.secret }).where(eq(steps.id, row.id));
    } else {
      await tx.insert(steps).values(row).onConflictDoUpdate({
        target: [steps.lessonVersionId, steps.idx],
        set: { public: row.public, secret: row.secret },
      });
    }
  }
}

async function seedWorld(tx: Tx, { manifest, files }: Loaded) {
  const course = { title: manifest.title, description: manifest.description };
  await tx
    .insert(worlds)
    .values({ slug: manifest.slug, ...course })
    .onConflictDoUpdate({ target: worlds.slug, set: course });
  const [world] = await tx.select().from(worlds).where(eq(worlds.slug, manifest.slug));
  const worldId = world.id;

  for (const c of manifest.concepts) {
    await tx
      .insert(concepts)
      .values({ worldId, ...c })
      .onConflictDoUpdate({ target: [concepts.worldId, concepts.slug], set: { name: c.name } });
  }

  for (const file of files) {
    const published = file.status === "published";
    const values = {
      slug: file.slug,
      worldId,
      title: file.title,
      position: file.position,
      status: file.status,
      sourceKind: file.source ? ("repo" as const) : ("authored" as const),
      source: file.source ?? null,
      concepts: file.concepts,
      kind: file.scrim ? ("scrim" as const) : ("predict" as const),
    };
    await tx
      .insert(lessons)
      .values(values)
      .onConflictDoUpdate({
        target: lessons.slug,
        set: values,
      });
    const [lesson] = await tx.select().from(lessons).where(eq(lessons.slug, file.slug));

    await tx
      .insert(lessonVersions)
      .values({ lessonId: lesson.id, version: 1, publishedAt: published ? new Date() : null })
      .onConflictDoNothing();
    const [version] = await tx.select().from(lessonVersions).where(and(eq(lessonVersions.lessonId, lesson.id), eq(lessonVersions.version, 1)));
    await tx.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
    await tx.update(lessonVersions).set({ content: file.scrim ?? null, publishedAt: published ? version.publishedAt ?? new Date() : null }).where(eq(lessonVersions.id, version.id));

    await seedSteps(tx, version.id, file);
  }
  return worldId;
}

async function seedNarration(file: LessonFile) {
  const scrim = file.scrim;
  if (!scrim || !storage) return;
  const [lesson] = await db.select({ versionId: lessons.currentVersionId }).from(lessons).where(eq(lessons.slug, file.slug));
  const versionId = lesson?.versionId;
  if (!versionId) throw new Error(`${file.slug}: no current version to attach narration to`);
  const ready = await db
    .select({ segment: lessonMedia.segment })
    .from(lessonMedia)
    .where(and(eq(lessonMedia.lessonVersionId, versionId), eq(lessonMedia.kind, "narration"), eq(lessonMedia.status, "ready")));
  const have = new Set(ready.map((r) => r.segment));
  for (const segment of scrim.segments.keys()) {
    if (have.has(segment)) continue;
    await saveMedia({ lessonVersionId: versionId, segment, kind: "narration", body: silentWav(SCRIM_PLACEHOLDER_MS), contentType: "audio/wav" });
  }
}

export async function seed({ narration = false } = {}) {
  if (narration && !storage) throw new Error("Configure object storage to seed narration");
  const main = await loadWorld("codequest");
  const samples = await Promise.all(SAMPLE_WORLDS.map(loadWorld));
  const scrimDemo = await loadWorld("scrim-demo");
  await db.transaction(async (tx) => {
    const codeQuestId = await seedWorld(tx, main);
    await seedWorld(tx, scrimDemo);

    const path = { title: "JavaScript Foundations", tagline: "Read real code and predict what it does" };
    await tx
      .insert(paths)
      .values({ slug: "js-foundations", ...path })
      .onConflictDoUpdate({ target: paths.slug, set: path });
    const [jsPath] = await tx.select().from(paths).where(eq(paths.slug, "js-foundations"));
    await tx
      .insert(pathCourses)
      .values({ pathId: jsPath.id, worldId: codeQuestId, position: 0 })
      .onConflictDoNothing();

    const samplePath = { title: "Sample courses", tagline: "Short courses to try LearnSlop" };
    await tx
      .insert(paths)
      .values({ slug: "sample-courses", ...samplePath })
      .onConflictDoUpdate({ target: paths.slug, set: samplePath });
    const [sample] = await tx.select().from(paths).where(eq(paths.slug, "sample-courses"));
    for (const [position, world] of samples.entries()) {
      const worldId = await seedWorld(tx, world);
      await tx.insert(pathCourses).values({ pathId: sample.id, worldId, position }).onConflictDoNothing();
    }
  });
  if (narration) {
    for (const file of [main, scrimDemo, ...samples].flatMap((world) => world.files)) await seedNarration(file);
  }
}

if (import.meta.main) {
  try {
    await seed({ narration: process.argv.includes("--narration") });
  } finally {
    await pool.end();
  }
}
