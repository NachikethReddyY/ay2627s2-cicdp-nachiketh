import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { code, out, readSteps, signUp, trpc } from "./helpers.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { learners, lessons, lessonVersions, partCompletions, steps, user, worlds, type PartSecret } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

async function addLesson(kind: "learn" | "watch", count: number) {
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [lesson] = await db.insert(lessons).values({ slug: `${kind}-${count}`, title: "Read", worldId: world!.id, sourceKind: "authored", kind, status: "published" }).returning();
  const content: PartSecret = kind === "learn" ? { kind, body: "PRIVATE_READ_CONTENT" } : { kind, beforeFiles: { "main.js": "before" }, hunks: [{ id: "h", file: "main.js", oldStart: 1, lines: ["+PRIVATE_READ_CONTENT"] }] };
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  const checks = count ? await db.insert(steps).values(readSteps.slice(0, count).map((s, idx) => ({
    lessonVersionId: version!.id, idx,
    public: { title: s.title, prompt: s.prompt, kind: s.kind, options: s.options },
    secret: { beforeFiles: s.beforeFiles, hunks: s.hunks, answer: s.answer, hints: s.hints, explanations: s.explanations, concepts: s.concepts },
  }))).returning() : [];
  return { lesson: lesson!, checks };
}

for (const kind of ["learn", "watch"] as const) {
  test(`${kind} content requires an opening prediction and at least two checks`, async () => {
    const cookie = await signUp(app);
    const api = trpc(app, cookie);
    for (const count of [0, 1, 2]) {
      const { checks } = await addLesson(kind, count);
      const get = async () => out(await api.q("lessons.get", { id: `${kind}-${count}` }));
      const before = await get();
      assert.equal(before.part, null);
      assert.deepEqual(before.media, []);
      assert.equal(before.steps.length, count);
      assert.equal(code(await api.m("parts.complete", { lessonId: `${kind}-${count}` })), "FORBIDDEN");
      if (count === 2) {
        assert.equal(code(await api.q("steps.get", { id: checks[1]!.id })), "CONFLICT");
        assert.equal(code(await api.m("steps.hint", { id: checks[1]!.id })), "CONFLICT");
      }
      if (count) {
        assert.equal((await api.m("steps.attempt", { id: checks[0]!.id, answer: { kind: "mcq", choice: 1 } })).statusCode, 200);
        const afterPrediction = await get();
        assert.equal(afterPrediction.part !== null, count === 2);
        if (count === 1) {
          assert.deepEqual(afterPrediction.media, []);
          assert.equal(afterPrediction.completed, false);
        }
      }
    }
  });

  test(`${kind} legacy completions remain accessible`, async () => {
    const cookie = await signUp(app);
    out(await trpc(app, cookie).q("home.get"));
    const [learner] = await db.select({ id: learners.id }).from(learners).innerJoin(user, eq(user.id, learners.userId)).where(eq(user.email, "a@example.com"));
    for (const count of [0, 1]) {
      const { lesson } = await addLesson(kind, count);
      await db.insert(partCompletions).values({ learnerId: learner!.id, lessonId: lesson.id });
      const result = out(await trpc(app, cookie).q("lessons.get", { id: `${kind}-${count}` }));
      assert.equal(result.completed, true);
      assert.equal(result.part.kind, kind);
    }
  });
}
