import { and, eq } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { saveMedia } from "../media/service.ts";
import { silentWav } from "../media/silent-wav.ts";
import { storage } from "../media/storage.ts";
import { slugOf } from "../progress/mastery.ts";
import { db, pool } from "./client.ts";
import { assertHunksApply, assertUniqueAcrossFiles, LessonFile, Manifest } from "./lesson-file.ts";
import { collectionPaths, collections, concepts, lessonMedia, lessons, lessonVersions, pathCourses, paths, steps, worlds } from "./schema.ts";

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
      sourceKind: file.source ? ("repo" as const) : ("authored" as const),
      source: file.source ?? null,
      concepts: file.concepts,
      kind: file.scrim ? ("scrim" as const) : ("predict" as const),
    };
    await tx
      .insert(lessons)
      .values({ ...values, status: file.status })
      .onConflictDoUpdate({
        target: lessons.slug,
        set: values,
      });
    const [lesson] = await tx.select().from(lessons).where(eq(lessons.slug, file.slug));

    await tx
      .insert(lessonVersions)
      .values({ lessonId: lesson.id, version: 1, publishedAt: published ? new Date() : null })
      .onConflictDoNothing();
    const [version] = await tx.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson.id));
    await tx.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
    await tx.update(lessonVersions).set({ content: file.scrim ?? null }).where(eq(lessonVersions.id, version.id));

    for (const [idx, s] of file.steps.entries()) {
      const row = {
        id: s.id ?? `${file.slug}-${idx}`,
        lessonVersionId: version.id,
        idx,
        public: s.public,
        secret: s.secret,
      };
      await tx.insert(steps).values(row).onConflictDoUpdate({ target: steps.id, set: row });
    }
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

export async function seed() {
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
    const startHere = { title: "Start here", description: "New to LearnSlop? Begin with these.", featured: true };
    const [created] = await tx
      .insert(collections)
      .values({ slug: "start-here", ...startHere })
      .onConflictDoNothing()
      .returning({ id: collections.id });
    if (created) await tx.insert(collectionPaths).values({ collectionId: created.id, pathId: jsPath.id, position: 0 });
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
  for (const file of [main, scrimDemo, ...samples].flatMap((world) => world.files)) await seedNarration(file);
}

if (import.meta.main) {
  await seed();
  await pool.end();
}
