import { out, readSteps, signUp, trpc } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { lessons, lessonVersions, partCompletions, stepProgress, steps, worlds, type PartSecret } from "../src/db/schema.ts";

const app = buildApp();
after(() => app.close());

type Kind = "learn" | "watch" | "practice";

const contentOf = (kind: Kind): PartSecret =>
  kind === "learn"
    ? { kind: "learn", body: "Read this first." }
    : kind === "watch"
      ? { kind: "watch", beforeFiles: { "main.js": "let x = 1;\n" }, hunks: [{ id: "h1", file: "main.js", oldStart: 1, lines: ["-let x = 1;", "+let x = 2;"] }] }
      : { kind: "practice", instructions: "Print 17.", language: "python", starterCode: "", expectedOutput: "17\n" };

async function addLesson(slug: string, kind: Kind, hintCount: number) {
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [lesson] = await db.insert(lessons).values({ slug, title: slug, worldId: world!.id, sourceKind: "authored", kind, status: "published" }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content: contentOf(kind) }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  const hints = Array.from({ length: hintCount }, (_, i) => ({ text: `Hint ${i + 1}`, ...(i === 0 && { eliminate: 2 }) }));
  const rows = readSteps.map((s, idx) => ({
    lessonVersionId: version!.id,
    idx,
    public: { title: s.title, prompt: s.prompt, kind: s.kind, options: s.options },
    secret: { beforeFiles: s.beforeFiles, hunks: s.hunks, answer: s.answer, hints, explanations: s.explanations, concepts: s.concepts },
  }));
  const ids = await db.insert(steps).values(rows).returning({ id: steps.id, idx: steps.idx });
  return ids.sort((a, b) => a.idx - b.idx).map((r) => r.id);
}

const RIGHT = { kind: "mcq", choice: 0 };
const WRONG = { kind: "mcq", choice: 1 };
const attempt = (c: string, id: string, answer: object) => trpc(app, c).m("steps.attempt", { id, answer });
const reveal = (c: string, id: string) => trpc(app, c).q("steps.reveal", { id });
const skip = (c: string, id: string) => trpc(app, c).m("steps.skip", { id });
const state = async (c: string, id: string) => out(await trpc(app, c).q("steps.get", { id })).state as string;

for (const kind of ["learn", "watch"] as const) {
  test(`a ${kind} check never reveals its answer, before or after it is finished`, async () => {
    const c = await signUp(app);
    const [opening, closing] = await addLesson(`${kind}-answers`, kind, 1);

    out(await attempt(c, opening!, WRONG));
    const early = await reveal(c, opening!);
    assert.equal(early.statusCode, 409);
    assert.equal("answer" in (early.json().result?.data ?? {}), false);
    assert.equal(await state(c, opening!), "hinting", "a refused reveal does not move the step");

    out(await trpc(app, c).m("steps.hint", { id: opening! }));
    const right = out(await attempt(c, opening!, RIGHT));
    assert.deepEqual([right.correct, right.state], [true, "revealed"]);
    const done = await reveal(c, opening!);
    assert.equal(done.statusCode, 409, "even a finished opening check does not hand over the answer");
    assert.equal(done.json().result, undefined);

    out(await attempt(c, closing!, RIGHT));
    assert.equal((await reveal(c, closing!)).statusCode, 409);
    assert.equal(await state(c, closing!), "revealed");
  });

  test(`a ${kind} closing check stays open for retries after a wrong answer`, async () => {
    const c = await signUp(app);
    const [opening, closing] = await addLesson(`${kind}-retries`, kind, 0);
    out(await attempt(c, opening!, WRONG));

    const first = out(await attempt(c, closing!, WRONG));
    assert.deepEqual([first.correct, first.state, first.attemptAllowed], [false, "hinting", true]);
    assert.equal((await db.select().from(partCompletions)).length, 1, "the first closing attempt completes the lesson");

    const second = out(await attempt(c, closing!, WRONG));
    assert.deepEqual([second.correct, second.state, second.attemptAllowed], [false, "hinting", true]);

    const third = out(await attempt(c, closing!, RIGHT));
    assert.deepEqual([third.correct, third.state], [true, "revealed"]);
    assert.equal((await db.select().from(partCompletions)).length, 1);
  });
}

test("practice: the answer is refused after attempts one and two and allowed after the third", async () => {
  const c = await signUp(app);
  const [step] = await addLesson("practice-tries", "practice", 0);

  assert.equal((await reveal(c, step!)).statusCode, 409, "no attempts yet");
  out(await attempt(c, step!, WRONG));
  assert.equal((await reveal(c, step!)).statusCode, 409, "after attempt one");
  out(await attempt(c, step!, WRONG));
  assert.equal((await reveal(c, step!)).statusCode, 409, "after attempt two");
  assert.equal(await state(c, step!), "hinting");

  const third = out(await attempt(c, step!, WRONG));
  assert.equal(third.state, "revealed");
  const shown = await reveal(c, step!);
  assert.equal(shown.statusCode, 200);
  assert.deepEqual(out(shown).answer, { type: "mcq", index: 0 });
});

test("practice: hints do not count as attempts", async () => {
  const c = await signUp(app);
  const [step] = await addLesson("practice-hints", "practice", 1);

  out(await attempt(c, step!, WRONG));
  out(await trpc(app, c).m("steps.hint", { id: step! }));
  out(await attempt(c, step!, WRONG));
  assert.equal((await reveal(c, step!)).statusCode, 409, "one hint plus two attempts is not three tries");
  out(await attempt(c, step!, WRONG));
  assert.equal((await reveal(c, step!)).statusCode, 200);
});

test("practice: skipping cannot be used to see the answer before three attempts", async () => {
  const c = await signUp(app);
  const [step] = await addLesson("practice-skip", "practice", 0);

  assert.equal((await skip(c, step!)).statusCode, 409);
  assert.equal((await reveal(c, step!)).statusCode, 409);
  assert.equal(await state(c, step!), "predicting");
});

test("practice: a correct answer does not reveal the explanation before three attempts", async () => {
  const c = await signUp(app);
  const [step] = await addLesson("practice-right", "practice", 0);
  const first = out(await attempt(c, step!, RIGHT));
  assert.equal(first.state, "hinting");
  assert.equal((await reveal(c, step!)).statusCode, 409);
  await db.update(stepProgress).set({ state: "revealed" }).where(eq(stepProgress.stepId, step!));
  assert.equal((await reveal(c, step!)).statusCode, 409, "an old revealed progress row cannot bypass the attempt limit");
  await db.update(stepProgress).set({ state: "hinting", attemptAllowed: true, retryAllowed: true }).where(eq(stepProgress.stepId, step!));
  out(await attempt(c, step!, RIGHT));
  assert.equal((await reveal(c, step!)).statusCode, 409);
  const third = out(await attempt(c, step!, RIGHT));
  assert.equal(third.state, "revealed");
  assert.equal((await reveal(c, step!)).statusCode, 200);
});
