import { eq } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { slugOf } from "../progress/mastery.ts";
import { db, pool } from "./client.ts";
import { assertHunksApply, assertUniqueAcrossFiles, LessonFile, Manifest } from "./lesson-file.ts";
import { collectionPaths, collections, concepts, lessons, lessonVersions, pathCourses, paths, steps, worlds } from "./schema.ts";

const WORLDS_DIR = join(import.meta.dirname, "../../../../worlds");

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

// Reads and validates worlds/<world>/manifest.json and lessons/*.json before the transaction opens, so bad content writes nothing.
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
  // Mastery keys concepts by slugOf(name); a different seeded slug would make a second row on a learner's first attempt.
  for (const c of manifest.concepts)
    if (c.slug !== slugOf(c.name)) throw new Error(`manifest concept "${c.name}": slug must be "${slugOf(c.name)}"`);
  const known = new Set(manifest.concepts.map((c) => c.name));
  for (const f of files) {
    const missing = f.concepts.filter((c) => !known.has(c));
    if (missing.length) throw new Error(`${f.slug}: concepts not in the manifest: ${missing.join(", ")}`);
  }
  return { manifest, files };
}

export async function seed() {
  const { manifest, files } = await loadWorld("codequest");
  await db.transaction(async (tx) => {
    const course = { title: manifest.title, description: manifest.description };
    await tx
      .insert(worlds)
      .values({ slug: manifest.slug, ...course })
      .onConflictDoUpdate({ target: worlds.slug, set: course });
    const [world] = await tx.select().from(worlds).where(eq(worlds.slug, manifest.slug));

    const path = { title: "JavaScript Foundations", tagline: "Read real code and predict what it does" };
    await tx
      .insert(paths)
      .values({ slug: "js-foundations", ...path })
      .onConflictDoUpdate({ target: paths.slug, set: path });
    const [jsPath] = await tx.select().from(paths).where(eq(paths.slug, "js-foundations"));
    const startHere = { title: "Start here", description: "New to LearnSlop? Begin with these.", featured: true };
    // Only a fresh database gets the starter collection and link; later admin edits (retitle, unfeature, setPaths) survive a reseed.
    const [created] = await tx
      .insert(collections)
      .values({ slug: "start-here", ...startHere })
      .onConflictDoNothing()
      .returning({ id: collections.id });
    if (created) await tx.insert(collectionPaths).values({ collectionId: created.id, pathId: jsPath!.id, position: 0 });
    await tx
      .insert(pathCourses)
      .values({ pathId: jsPath!.id, worldId: world!.id, position: 0 })
      .onConflictDoNothing();

    for (const c of manifest.concepts) {
      await tx
        .insert(concepts)
        .values({ worldId: world!.id, ...c })
        .onConflictDoUpdate({ target: [concepts.worldId, concepts.slug], set: { name: c.name } });
    }

    for (const file of files) {
      const published = file.status === "published";
      const values = {
        slug: file.slug,
        worldId: world!.id,
        title: file.title,
        position: file.position,
        sourceKind: file.source ? ("repo" as const) : ("authored" as const),
        source: file.source ?? null,
        concepts: file.concepts,
      };
      await tx
        .insert(lessons)
        .values({ ...values, status: file.status })
        .onConflictDoUpdate({
          target: lessons.slug,
          // Status is set on insert only: once the row exists, publish and unpublish belong to the author, not the file.
          set: values,
        });
      const [lesson] = await tx.select().from(lessons).where(eq(lessons.slug, file.slug));

      await tx
        .insert(lessonVersions)
        .values({ lessonId: lesson!.id, version: 1, publishedAt: published ? new Date() : null })
        .onConflictDoNothing();
      const [version] = await tx.select().from(lessonVersions).where(eq(lessonVersions.lessonId, lesson!.id));
      await tx.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));

      for (const [idx, s] of file.steps.entries()) {
        // Repo-owned content: a reseed overwrites public and secret on purpose, so the JSON files stay the source of truth.
        const row = {
          // Lesson 1 pins s1..s3 (the web contract); other lessons default to <slug>-<idx>.
          id: s.id ?? `${file.slug}-${idx}`,
          lessonVersionId: version!.id,
          idx,
          public: s.public,
          secret: s.secret,
        };
        await tx.insert(steps).values(row).onConflictDoUpdate({ target: steps.id, set: row });
      }
    }
  });
}

if (import.meta.main) {
  await seed();
  await pool.end();
}
