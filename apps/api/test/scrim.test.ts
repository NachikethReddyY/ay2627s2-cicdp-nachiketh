import { code, out, signUp, trpc } from "./helpers.ts";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, afterEach, test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import {
  attempts, checkResults, hintEvents, learners, lessonMedia, lessons, lessonVersions,
  partCompletions, stepProgress, steps, worlds, type PartSecret,
} from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { memoryStorage, setStorage } from "../src/media/storage.ts";
import { setCheckSpawnForTests, type RawResult } from "../src/sandbox/check.ts";

const app = buildApp();
after(() => app.close());
afterEach(() => {
  setStorage(null);
  setCheckSpawnForTests();
});

const slug = "scrim-echo";
const gateIdx = 7;
const gateTitle = "Predict the next run";
const gateAnswer = { index: 1, option: "GATE_ANSWER_OPTION_PRIVATE" };
const gatePrompt = "GATE_PROMPT_ONLY_ON_STEP";
const gateAccepted = "GATE_ACCEPTED_PRIVATE";
const gateHint = "GATE_HINT_PRIVATE";
const gateExplanations = { workedExample: "GATE_WORKED_EXAMPLE_PRIVATE", practice: "GATE_PRACTICE_EXPLANATION_PRIVATE" };
const hiddenContent = "LAB_HIDDEN_CONTENT_PRIVATE";
const hiddenActual = "LAB_HIDDEN_ACTUAL_PRIVATE";
const hiddenError = "LAB_HIDDEN_ERROR_PRIVATE";
const publicTests = [
  { id: "s1", name: "Sample one", visibility: "sample", stretch: false, stdin: "SAMPLE_ONE_IN", expectedStdout: "SAMPLE_ONE_OUT" },
  { id: "s2", name: "Sample two", visibility: "sample", stretch: false, stdin: "SAMPLE_TWO_IN", expectedStdout: "SAMPLE_TWO_OUT" },
  { id: "h1", name: "Hidden one", visibility: "hidden", stretch: false },
  { id: "h2", name: "Hidden two", visibility: "hidden", stretch: true },
] as const;
const hiddenIO = [
  { stdin: "LAB_HIDDEN_ONE_IN_PRIVATE", expectedStdout: "LAB_HIDDEN_ONE_OUT_PRIVATE" },
  { stdin: "LAB_HIDDEN_TWO_IN_PRIVATE", expectedStdout: "LAB_HIDDEN_TWO_OUT_PRIVATE" },
] as const;
const scrim = {
  kind: "scrim",
  language: "javascript",
  segments: [
    { text: "Read the function", durationMs: 1200 },
    { text: "Try an edit", durationMs: 1500, edit: { code: "console.log(1)", run: true } },
    { text: "Make a prediction", durationMs: 1700, gate: gateIdx },
    { text: "Try the lab", durationMs: 900 },
  ],
  lab: {
    kind: "practice",
    instructions: "Write a program that maps each input to its output.",
    language: "javascript",
    starterCode: "const input = '';",
    tests: [publicTests[0], publicTests[1],
      { ...publicTests[2], ...hiddenIO[0], content: hiddenContent },
      { ...publicTests[3], ...hiddenIO[1], content: hiddenContent },
    ],
  },
} satisfies Extract<PartSecret, { kind: "scrim" }> & {
  lab: { tests: Array<{ content?: string }> };
};

const hiddenValues = hiddenIO.flatMap(({ stdin, expectedStdout }) => [stdin, expectedStdout]);

function assertOmitted(body: unknown, markers: readonly string[]) {
  const serialized = JSON.stringify(body);
  for (const marker of markers) assert.ok(!serialized.includes(marker), `Response leaked ${marker}`);
}

async function insertScrim() {
  const [world] = await db.insert(worlds).values({ slug: "scrim-test-world" }).returning({ id: worlds.id });
  const [lesson] = await db.insert(lessons).values({
    slug, title: "Scrim echo", worldId: world.id, kind: "scrim", sourceKind: "authored", status: "published",
  }).returning({ id: lessons.id });
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson.id, version: 1, content: scrim }).returning({ id: lessonVersions.id });
  const [gate] = await db.insert(steps).values({
    lessonVersionId: version.id,
    idx: gateIdx,
    public: { title: gateTitle, kind: "mcq", prompt: gatePrompt, options: ["First option", gateAnswer.option, "Third option"] },
    secret: {
      answer: gateAnswer.index,
      accepted: [gateAccepted],
      hints: [{ text: gateHint, eliminate: 2 }],
      explanations: gateExplanations,
      beforeFiles: {},
      hunks: [],
    },
  }).returning({ id: steps.id });
  await db.update(lessons).set({ currentVersionId: version.id }).where(eq(lessons.id, lesson.id));
  return { lessonId: lesson.id, versionId: version.id, gateId: gate.id };
}

const narration = { kind: "narration", status: "ready", contentType: "audio/wav", bytes: 12 } as const;

test("the migrated database allows distinct ready narration segments and rejects a duplicate", async () => {
  const { versionId } = await insertScrim();
  const column = await pool.query<{ data_type: string; is_nullable: string }>(
    "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lesson_media' AND column_name = 'segment'",
  );
  assert.deepEqual(column.rows, [{ data_type: "integer", is_nullable: "YES" }]);

  const rows = await db.insert(lessonMedia).values([
    { ...narration, lessonVersionId: versionId, segment: 0 },
    { ...narration, lessonVersionId: versionId, segment: 1 },
  ]).returning({ segment: lessonMedia.segment, state: lessonMedia.status });
  assert.deepEqual(rows, [{ segment: 0, state: "ready" }, { segment: 1, state: "ready" }]);
  await assert.rejects(pool.query(
    "INSERT INTO lesson_media (id, lesson_version_id, segment, kind, status, content_type, bytes) VALUES ('duplicate-narration', $1, 0, 'narration', 'ready', 'audio/wav', 12)",
    [versionId],
  ), { code: "23505", constraint: "lesson_media_one_narration" });
});

test("lessons.get returns segments, a resolved gate and sample tests with no secrets", async () => {
  const t = trpc(app, await signUp(app));
  const { versionId, gateId } = await insertScrim();
  setStorage(memoryStorage());
  await db.insert(lessonMedia).values({ ...narration, lessonVersionId: versionId, segment: 1, key: "scrim-segment-1.wav" });

  const res = await t.q("lessons.get", { id: slug });
  assert.equal(res.statusCode, 200, res.body);
  assertOmitted(res.json(), [
    gateAnswer.option, gatePrompt, gateAccepted, gateHint, ...Object.values(gateExplanations), hiddenContent, ...hiddenValues,
    '"answer"', '"accepted"', '"hints"', '"explanations"', '"secret"', '"expectedOutput"',
  ]);
  assert.deepEqual(out(res), {
    id: slug,
    title: "Scrim echo",
    kind: "scrim",
    part: {
      kind: "scrim",
      language: "javascript",
      segments: [scrim.segments[0], scrim.segments[1], { ...scrim.segments[2], gate: gateId }, scrim.segments[3]],
      lab: {
        kind: "practice", instructions: scrim.lab.instructions, language: "javascript", starterCode: scrim.lab.starterCode,
        tests: publicTests,
      },
    },
    steps: [{ id: gateId, idx: gateIdx, title: gateTitle, hintCount: 1, state: "predicting" }],
    completed: false,
    media: [{ stepId: null, segment: 1, kind: "narration", url: "memory://scrim-segment-1.wav" }],
  });
});

test("lessons.get fails closed for malformed scrim content and invalid gates", async () => {
  const t = trpc(app, await signUp(app));
  const { versionId, gateId } = await insertScrim();
  const invalidVersion = async (content: PartSecret | null) => {
    await db.update(lessonVersions).set({ content }).where(eq(lessonVersions.id, versionId));
    const res = await t.q("lessons.get", { id: slug });
    assert.equal(res.statusCode, 500);
    assert.equal(code(res), "INTERNAL_SERVER_ERROR");
    assertOmitted(res.json(), [gateAccepted, gateHint, ...Object.values(gateExplanations), hiddenContent, ...hiddenValues]);
  };
  await invalidVersion(null);
  await invalidVersion({ ...scrim, segments: [] });
  await invalidVersion({ ...scrim, segments: [{ text: "Missing step", durationMs: 700, gate: gateIdx + 1 }] });
  await db.update(steps).set({ public: { title: gateTitle, kind: "cloze", prompt: gatePrompt } }).where(eq(steps.id, gateId));
  await invalidVersion(scrim);
});

test("a scrim gate uses the normal MCQ attempt, hint, reveal and progress flow", async () => {
  const t = trpc(app, await signUp(app));
  const { gateId } = await insertScrim();
  const lesson = out(await t.q("lessons.get", { id: slug }));
  const gate = { id: lesson.part.segments[2].gate as string };
  assert.equal(gate.id, gateId);
  const initial = await t.q("steps.get", gate);
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(out(initial).hints, []);
  assert.equal((await t.q("steps.reveal", gate)).statusCode, 409);

  const wrongAnswer = { kind: "mcq", choice: 0 };
  const wrong = await t.m("steps.attempt", { ...gate, answer: wrongAnswer });
  assert.equal(wrong.statusCode, 200, wrong.body);
  const first = out(wrong);
  assert.deepEqual([first.correct, first.state, first.hintsUsed, first.attemptAllowed], [false, "hinting", 0, false]);
  assert.equal((await t.q("steps.reveal", gate)).statusCode, 409);

  const hint = await t.m("steps.hint", gate);
  assert.equal(hint.statusCode, 200, hint.body);
  assert.deepEqual(out(hint), { rung: 1, text: gateHint, eliminate: 2 });

  const rightAnswer = { kind: "mcq", choice: gateAnswer.index };
  const right = await t.m("steps.attempt", { ...gate, answer: rightAnswer });
  assert.equal(right.statusCode, 200, right.body);
  const second = out(right);
  assert.deepEqual([second.correct, second.state, second.hintsUsed], [true, "revealed", 1]);

  const reveal = await t.q("steps.reveal", gate);
  assert.equal(reveal.statusCode, 200, reveal.body);
  assert.deepEqual(out(reveal).answer, { type: "mcq", index: gateAnswer.index });
  assert.deepEqual(out(reveal).explanations, { ...gateExplanations, inferred: true });
  assert.equal(out(await t.q("lessons.get", { id: slug })).steps[0].state, "revealed");

  const [learner] = await db.select({ id: learners.id }).from(learners);
  const progress = await db.select({
    state: stepProgress.state, rungsTaken: stepProgress.rungsTaken, attemptAllowed: stepProgress.attemptAllowed, retryAllowed: stepProgress.retryAllowed,
  }).from(stepProgress).where(and(eq(stepProgress.stepId, gateId), eq(stepProgress.learnerId, learner.id)));
  assert.deepEqual(progress, [{ state: "revealed", rungsTaken: 1, attemptAllowed: true, retryAllowed: false }]);
  const storedHints = await db.select({ learnerId: hintEvents.learnerId, rung: hintEvents.rung }).from(hintEvents).where(eq(hintEvents.stepId, gateId));
  assert.deepEqual(storedHints, [{ learnerId: learner.id, rung: 1 }]);
  const storedAttempts = await db.select({
    learnerId: attempts.learnerId, id: attempts.id, response: attempts.response, kind: attempts.kind,
    correct: attempts.correct, hintsUsed: attempts.hintsUsed, observed: attempts.observed,
  }).from(attempts).where(eq(attempts.stepId, gateId)).orderBy(asc(attempts.hintsUsed));
  assert.deepEqual(storedAttempts, [
    { learnerId: learner.id, id: first.attemptId, response: wrongAnswer, kind: "mcq", correct: false, hintsUsed: 0, observed: true },
    { learnerId: learner.id, id: second.attemptId, response: rightAnswer, kind: "mcq", correct: true, hintsUsed: 1, observed: false },
  ]);
});

function fakeSandbox(stdout: string[]) {
  const submissions: Array<{ token: string; tests: Array<{ stdin: string }> }> = [];
  setCheckSpawnForTests((() => {
    const output = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stdout: output,
      stderr: new EventEmitter(),
      kill: () => true,
      stdin: Object.assign(new EventEmitter(), {
        end(payload: string) {
          const submission = JSON.parse(payload) as (typeof submissions)[number];
          submissions.push(submission);
          const results: RawResult[] = stdout.map((value) => ({ exit: 0, timedOut: false, overflow: false, stdout: value, stderr: hiddenError }));
          setImmediate(() => {
            output.emit("data", Buffer.from(JSON.stringify({ token: submission.token, results })));
            child.emit("close", 0);
          });
        },
      }),
    });
    return child;
  }) as never);
  return submissions;
}

test("sandbox check grades the scrim lab and records completion without returning hidden test data", async (t) => {
  const cookie = await signUp(app);
  const { lessonId } = await insertScrim();
  const previous = env.SANDBOX_ENABLED;
  env.SANDBOX_ENABLED = true;
  t.after(() => { env.SANDBOX_ENABLED = previous; });
  const check = () => app.inject({
    method: "POST", url: "/api/sandbox/check", headers: { cookie, origin: env.PUBLIC_ORIGIN },
    payload: { code: "console.log('LEARNER_SUBMISSION')", language: "javascript", lessonId: slug },
  });
  const expectedResults = [
    { ...publicTests[0], status: "pass", actualStdout: publicTests[0].expectedStdout },
    { ...publicTests[1], status: "pass", actualStdout: publicTests[1].expectedStdout },
    { ...publicTests[2], status: "fail" },
    { ...publicTests[3], status: "pass" },
  ];
  const sampleOutputs = [publicTests[0].expectedStdout, publicTests[1].expectedStdout];
  const submissions = fakeSandbox([...sampleOutputs, hiddenActual, hiddenIO[1].expectedStdout]);
  const failed = await check();
  assert.equal(failed.statusCode, 200, failed.body);
  assertOmitted(failed.json(), [...hiddenValues, hiddenActual, hiddenError]);
  assert.deepEqual(failed.json(), {
    results: expectedResults, required: { passed: 2, total: 3 }, stretch: { passed: 1, total: 1 },
    points: 3, maxPoints: 4, complete: false, best: { points: 3, maxPoints: 4 },
  });
  assert.deepEqual(submissions[0].tests, scrim.lab.tests.map(({ stdin }) => ({ stdin })));
  assert.equal((await db.select().from(partCompletions).where(eq(partCompletions.lessonId, lessonId))).length, 0);

  fakeSandbox([...sampleOutputs, hiddenIO[0].expectedStdout, hiddenIO[1].expectedStdout]);
  const passed = await check();
  assert.equal(passed.statusCode, 200, passed.body);
  assertOmitted(passed.json(), [...hiddenValues, hiddenActual, hiddenError]);
  assert.deepEqual(passed.json(), {
    results: [expectedResults[0], expectedResults[1], { ...publicTests[2], status: "pass" }, expectedResults[3]],
    required: { passed: 3, total: 3 }, stretch: { passed: 1, total: 1 },
    points: 4, maxPoints: 4, complete: true, best: { points: 4, maxPoints: 4 },
  });
  const [learner] = await db.select({ id: learners.id }).from(learners);
  const completed = await db.select({ learnerId: partCompletions.learnerId }).from(partCompletions).where(eq(partCompletions.lessonId, lessonId));
  assert.deepEqual(completed, [{ learnerId: learner.id }]);
  const scores = await db.select({
    learnerId: checkResults.learnerId, bestPoints: checkResults.bestPoints, maxPoints: checkResults.maxPoints, complete: checkResults.complete,
  }).from(checkResults).where(eq(checkResults.lessonId, lessonId));
  assert.deepEqual(scores, [{ learnerId: learner.id, bestPoints: 4, maxPoints: 4, complete: true }]);
});
