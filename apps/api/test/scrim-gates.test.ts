import { code, out, signUp, trpc } from "./helpers.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { learners, partCompletions, stepProgress } from "../src/db/schema.ts";
import { insertScrimLesson, secrets, segmentCode, segmentText } from "./scrim-fixture.ts";

const app = buildApp();
after(() => app.close());

const slug = "gated-steps";
const plan = [{ edit: true }, { gate: 0, edit: true }, { edit: true }, { gate: 1, edit: true }, { edit: true }];
const right = { kind: "mcq", choice: 1 } as const;
const wrong = { kind: "mcq", choice: 0 } as const;

async function setup() {
  const t = trpc(app, await signUp(app));
  const lesson = await insertScrimLesson(slug, plan);
  assert.equal((await t.q("lessons.get", { id: "no-such-lesson" })).statusCode, 404);
  const [learner] = await db.select({ id: learners.id }).from(learners);
  return { t, learnerId: learner!.id, ...lesson, first: lesson.stepIds.get(0)!, second: lesson.stepIds.get(1)! };
}

const allOf = (gate: number) => Object.values(secrets(gate));

test("every step route refuses a gate behind the first unrevealed gate and leaks nothing", async () => {
  const { t, second } = await setup();
  for (const res of [
    await t.q("steps.get", { id: second }),
    await t.q("steps.reveal", { id: second }),
    await t.m("steps.attempt", { id: second, answer: right }),
    await t.m("steps.hint", { id: second }),
    await t.m("steps.skip", { id: second }),
  ]) {
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(code(res), "CONFLICT");
    for (const marker of [...allOf(1), segmentText(4), segmentCode(3)]) assert.ok(!res.body.includes(marker), `leaked ${marker}`);
  }
  const rows = await db.select().from(stepProgress);
  assert.deepEqual(rows, []);
});

test("the first gate works, and the next gate opens only after it is revealed", async () => {
  const { t, first, second } = await setup();
  const initial = out(await t.q("lessons.get", { id: slug }));
  assert.deepEqual(initial.part.segments.map((s: { text: string }) => s.text), [0, 1].map(segmentText));
  assert.deepEqual(initial.steps.map((s: { id: string }) => s.id), [first]);

  const step = await t.q("steps.get", { id: first });
  assert.equal(step.statusCode, 200, step.body);
  assert.deepEqual(out(step).beforeFiles, { "src/main.js": secrets(0).before });
  assert.equal((await t.q("steps.reveal", { id: first })).statusCode, 409);
  assert.equal((await t.q("steps.get", { id: second })).statusCode, 409);

  const done = await t.m("steps.attempt", { id: first, answer: right });
  assert.equal(out(done).state, "revealed");
  assert.equal((await t.q("steps.reveal", { id: first })).statusCode, 200);
  const afterFirst = await t.q("steps.get", { id: second });
  assert.equal(afterFirst.statusCode, 200, afterFirst.body);
  assert.deepEqual(out(afterFirst).beforeFiles, { "src/main.js": secrets(1).before });

  const reopened = out(await t.q("lessons.get", { id: slug }));
  assert.deepEqual(reopened.part.segments.map((s: { text: string }) => s.text), [0, 1, 2, 3].map(segmentText));
  assert.deepEqual(reopened.steps.map((s: { id: string }) => s.id), [first, second]);
  assert.equal((await t.q("steps.reveal", { id: second })).statusCode, 409);
});

test("a gate answered wrongly is still revealed after its hints and a retry, which opens the next gate", async () => {
  const { t, first, second } = await setup();
  const state = async (res: Awaited<ReturnType<typeof t.m>>) => (out(res) as { state: string }).state;
  assert.equal(await state(await t.m("steps.attempt", { id: first, answer: wrong })), "hinting");
  assert.equal(out(await t.m("steps.hint", { id: first })).text, secrets(0).hint);
  assert.equal(await state(await t.m("steps.attempt", { id: first, answer: wrong })), "hinting");
  assert.equal(await state(await t.m("steps.attempt", { id: first, answer: wrong })), "revealed");

  const reveal = await t.q("steps.reveal", { id: first });
  assert.equal(reveal.statusCode, 200, reveal.body);
  assert.equal(out(reveal).explanations.workedExample, secrets(0).worked);
  assert.equal((await t.q("steps.get", { id: second })).statusCode, 200);
});

test("a gate cannot be skipped, even the first one", async () => {
  const { t, first } = await setup();
  const res = await t.m("steps.skip", { id: first });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal((await t.q("steps.reveal", { id: first })).statusCode, 409);
  assert.deepEqual(await db.select().from(stepProgress), []);
});

test("a hinting gate stays the pending gate and keeps later segments withheld", async () => {
  const { t, first } = await setup();
  await t.m("steps.hint", { id: first });
  const lesson = await t.q("lessons.get", { id: slug });
  assert.equal(out(lesson).steps[0].state, "hinting");
  assert.equal(out(lesson).part.segments.length, 2);
  assert.ok(!lesson.body.includes(segmentText(2)));
  assert.equal((await t.q("lessons.scrimMore", { id: slug, from: 3 })).statusCode, 409);
});

test("a gate skipped before skipping was removed counts as unanswered and can still be answered", async () => {
  const { t, first, learnerId } = await setup();
  await db.insert(stepProgress).values({ learnerId, stepId: first, state: "skipped" });
  const lesson = out(await t.q("lessons.get", { id: slug }));
  assert.equal(lesson.part.segments.length, 2);
  assert.equal(lesson.steps[0].state, "predicting");
  assert.equal(out(await t.q("steps.get", { id: first })).state, "predicting");
  assert.equal((await t.q("steps.reveal", { id: first })).statusCode, 409);
  const answered = await t.m("steps.attempt", { id: first, answer: right });
  assert.equal(answered.statusCode, 200, answered.body);
  assert.equal(out(answered).state, "revealed");
  const [row] = await db.select().from(stepProgress).where(eq(stepProgress.stepId, first));
  assert.equal(row!.state, "revealed");
});

test("the lab alone, or the lab with a skipped gate, does not complete the lesson; revealing every gate does", async () => {
  const { t, learnerId, lessonId, worldSlug, first, second } = await setup();
  const done = async () => out(await t.q("courses.get", { slug: worldSlug })).lessons.find((l: { slug: string }) => l.slug === slug).done;
  await db.insert(partCompletions).values({ lessonId, learnerId });
  assert.equal(await done(), 0);
  assert.equal((await t.m("steps.skip", { id: first })).statusCode, 409);
  assert.equal(await done(), 0);
  await t.m("steps.attempt", { id: first, answer: right });
  assert.equal(await done(), 0);
  await t.m("steps.attempt", { id: second, answer: right });
  assert.equal(await done(), 1);
});

test("revealing every gate without passing the lab does not complete the lesson", async () => {
  const { t, worldSlug, first, second } = await setup();
  await t.m("steps.attempt", { id: first, answer: right });
  await t.m("steps.attempt", { id: second, answer: right });
  const lesson = out(await t.q("courses.get", { slug: worldSlug })).lessons.find((l: { slug: string }) => l.slug === slug);
  assert.equal(lesson.done, 0);
});
