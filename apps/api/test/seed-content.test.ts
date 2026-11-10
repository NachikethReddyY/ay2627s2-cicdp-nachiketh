import "./helpers.ts";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import fixture from "../../web/src/player/fixtures/lesson1.ts";
import { db } from "../src/db/client.ts";
import { LessonFile } from "../src/db/lesson-file.ts";
import { concepts, lessons, steps } from "../src/db/schema.ts";
import { seed } from "../src/db/seed.ts";

const DIR = join(import.meta.dirname, "../../../worlds/codequest/lessons");
const load = async (name: string) => LessonFile.parse(JSON.parse(await readFile(join(DIR, name), "utf8")));

test("the web fixture and lesson-1.json describe the same lesson", async () => {
  const file = await load("lesson-1.json");
  assert.equal(file.title, fixture.title);
  assert.deepEqual(file.source, fixture.source);
  const fromFixture = fixture.steps.map((s) => ({
    id: s.id,
    public: { title: s.title, prompt: s.prompt, kind: s.kind, ...(s.options ? { options: s.options } : {}) },
    secret: {
      beforeFiles: s.input.beforeFiles,
      hunks: s.input.hunks,
      answer: s.answer,
      ...(s.accepted ? { accepted: s.accepted } : {}),
      hints: s.hints,
      explanations: s.explanations,
    },
  }));
  const fromJson = file.steps.map(({ secret: { narration: _n, ...secret }, ...s }) => ({ ...s, secret }));
  assert.deepEqual(fromJson, fromFixture);
  assert.ok(file.steps.every((s) => s.secret.narration), "every lesson 1 step has narration text");
});

test("every lesson file validates, keeps hunks consistent and never leaks the answer", async () => {
  for (const name of (await readdir(DIR)).filter((f) => f.endsWith(".json"))) {
    const file = await load(name);
    file.steps.forEach((s, i) => {
      const next = file.steps[i + 1];
      if (next) {
        // Applying this step's hunks to its files must give the next step's files.
        const after = applyHunks(s.secret.beforeFiles, s.secret.hunks);
        for (const [path, text] of Object.entries(next.secret.beforeFiles)) {
          assert.equal(after[path], text, `${name} step ${i}: ${path}`);
        }
      }
      const answers = [typeof s.secret.answer === "string" ? s.secret.answer : "", ...(s.secret.accepted ?? [])].filter(Boolean);
      const visible = [s.public.title, s.public.prompt, ...s.secret.hints.map((h) => h.text), s.secret.explanations.practice];
      for (const a of answers) for (const t of visible) assert.ok(!t.toLowerCase().includes(a.toLowerCase()), `${name} step ${i} leaks "${a}"`);
    });
  }
});

test("lesson-2 is a draft", async () => {
  assert.equal((await load("lesson-2.json")).status, "draft");
});

test("seed is idempotent and gives the expected ids", async () => {
  const count = async () => ({
    lessons: (await db.select().from(lessons)).length,
    steps: (await db.select().from(steps)).length,
    concepts: (await db.select().from(concepts)).length,
  });
  await seed();
  const first = await count();
  await seed();
  assert.deepEqual(await count(), first);
  assert.deepEqual(first, { lessons: 2, steps: 6, concepts: 3 });

  const l1 = (await db.select().from(lessons).where(eq(lessons.slug, "lesson-1")))[0]!;
  const l2 = (await db.select().from(lessons).where(eq(lessons.slug, "lesson-2")))[0]!;
  assert.equal(l1.status, "published");
  assert.equal(l2.status, "draft");
  const ids = async (versionId: string | null) =>
    (await db.select().from(steps).where(eq(steps.lessonVersionId, versionId!))).sort((a, b) => a.idx - b.idx).map((s) => s.id);
  assert.deepEqual(await ids(l1.currentVersionId), ["s1", "s2", "s3"]);
  assert.deepEqual(await ids(l2.currentVersionId), ["lesson-2-0", "lesson-2-1", "lesson-2-2"]);
  const [s1] = await db.select().from(steps).where(eq(steps.id, "s1"));
  assert.ok(s1!.secret.narration);
});

type Hunk = { file: string; oldStart: number; lines: string[] };
function applyHunks(files: Record<string, string>, hunks: Hunk[]) {
  const out = { ...files };
  for (const h of hunks) {
    const src = out[h.file]!.split("\n");
    const head = src.slice(0, h.oldStart - 1);
    let pos = h.oldStart - 1;
    const body: string[] = [];
    for (const l of h.lines) {
      const text = l.slice(1);
      if (l[0] === "+") body.push(text);
      else {
        assert.equal(src[pos], text, `hunk context mismatch in ${h.file}`);
        pos++;
        if (l[0] === " ") body.push(text);
      }
    }
    out[h.file] = [...head, ...body, ...src.slice(pos)].join("\n");
  }
  return out;
}
