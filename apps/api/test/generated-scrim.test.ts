import { out, signUp, trpc } from "./helpers.ts";
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { lessons, lessonVersions, steps } from "../src/db/schema.ts";
import { env } from "../src/env.ts";
import { generator } from "../src/ai/generator.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { idle } from "../src/ai/service.ts";
import { validatePart } from "../src/visuals/gate.ts";

const app = buildApp();
after(() => app.close());

const outline = {
  title: "Learn JavaScript functions",
  tagline: "Return values",
  courses: [0, 1].map((c) => ({
    title: `Course ${c}`,
    description: "d",
    lessons: [
      { title: `Lesson ${c}.1`, level: 1, concepts: ["return values"], kind: "scrim" },
      { title: `Lesson ${c}.2`, level: 2, concepts: ["return values"], kind: "learn" },
      { title: `Lesson ${c}.3`, level: 3, concepts: ["return values"], kind: "learn" },
    ],
  })),
};

const before = "export function add(a, b) {\n  console.log(a + b);\n}\n";
const after1 = "export function add(a, b) {\n  return a + b;\n}\n";
const scrimDraft = {
  kind: "scrim",
  language: "javascript",
  segments: [
    { text: "Here is add.", durationMs: 1500, edit: { code: before, run: false } },
    { text: "Run it and predict the value the caller gets.", durationMs: 2000, edit: { code: before, run: true }, gate: 0 },
    { text: "Return the sum now.", durationMs: 1800, edit: { code: after1, run: true }, gate: 1 },
    { text: "Now the lab.", durationMs: 1000 },
  ],
  steps: [
    {
      kind: "mcq",
      title: "What add gives back",
      prompt: "add prints the sum. What does add(2, 3) hand back?",
      beforeFiles: { "src/add.js": before },
      hunks: [{ id: "h1", file: "src/add.js", oldStart: 1, lines: [" export function add(a, b) {", "-  console.log(a + b);", "+  return a + b;", " }"] }],
      options: ["GEN_ANSWER_OPTION_PRIVATE", "5, because the sum is returned", "Nothing, because add throws", "3, because the last argument wins"],
      answer: 0,
      hints: [{ text: "GEN_HINT_PRIVATE", eliminate: 2 }],
      explanations: { workedExample: "GEN_WORKED_EXAMPLE_PRIVATE", practice: "GEN_PRACTICE_PRIVATE" },
      concepts: ["return values"],
    },
    {
      kind: "mcq",
      title: "Which sum comes back",
      prompt: "The body now returns b + a. What does add(2, 3) return?",
      beforeFiles: { "src/add.js": after1 },
      hunks: [{ id: "h2", file: "src/add.js", oldStart: 2, lines: ["-  return a + b;", "+  return b + a;"] }],
      options: ["A different number", "5, the same sum", "GEN_ANSWER_OPTION_TWO_PRIVATE", "undefined"],
      answer: 1,
      hints: [{ text: "GEN_HINT_TWO_PRIVATE", eliminate: 2 }],
      explanations: { workedExample: "GEN_WORKED_TWO_PRIVATE", practice: "GEN_PRACTICE_TWO_PRIVATE" },
      concepts: [],
    },
  ],
  lab: {
    kind: "practice",
    instructions: "Write double(n) so it returns n times 2.",
    language: "javascript",
    starterCode: "function double(n) {\n  \n}\n",
    tests: [
      { id: "two", name: "doubles two", stdin: "2", expectedStdout: "4\n", visibility: "sample", stretch: false },
      { id: "zero", name: "handles zero", stdin: "LAB_HIDDEN_STDIN_PRIVATE", expectedStdout: "LAB_HIDDEN_EXPECTED_PRIVATE", visibility: "hidden", stretch: false },
    ],
  },
};

const withSegments = (segments: unknown[]) => ({ ...scrimDraft, segments });

beforeEach(() => {
  env.AI_WRITE_COURSE_ON_GENERATE = false;
  env.ENGINE_TOKEN = "t".repeat(32);
  generator.outline = async () => outline;
  engineParts.lesson = async () => structuredClone(scrimDraft);
});

async function setup(email = "gen-scrim@example.com") {
  const t = trpc(app, await signUp(app, email));
  const res = await t.m("paths.generate", { prompt: "learn javascript functions" });
  assert.equal(res.statusCode, 200, res.body);
  const { firstCourseSlug } = out(res);
  const course = out(await t.q("courses.get", { slug: firstCourseSlug }));
  return { t, lessons: course.lessons as { slug: string }[] };
}

function assertOmitted(body: unknown, markers: readonly string[]) {
  const serialized = JSON.stringify(body);
  for (const marker of markers) assert.ok(!serialized.includes(marker), `Response leaked ${marker}`);
}

test("a generated scrim is stored without steps, and its gate steps are written as mcq rows", async () => {
  const { t, lessons: ls } = await setup();
  assert.equal((await t.q("lessons.get", { id: ls[0]!.slug })).statusCode, 200);
  await idle();

  const [row] = await db.select().from(lessons).where(eq(lessons.slug, ls[0]!.slug));
  assert.deepEqual([row!.kind, row!.status], ["scrim", "draft"]);
  const [version] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, row!.currentVersionId!));
  assert.equal(version!.content?.kind, "scrim");
  assert.equal("steps" in version!.content!, false);

  const rows = await db.select().from(steps).where(eq(steps.lessonVersionId, version!.id)).orderBy(asc(steps.idx));
  assert.deepEqual(rows.map((r) => [r.idx, r.public.kind, r.public.title]), [
    [0, "mcq", "What add gives back"],
    [1, "mcq", "Which sum comes back"],
  ]);
  assert.deepEqual(rows.map((r) => r.secret.answer), [0, 1]);
});

test("lessons.get points each gate at its step id and leaks no gate answer, hint, or hidden lab expectation", async () => {
  const { t, lessons: ls } = await setup("gen-scrim-get@example.com");
  const res = await t.q("lessons.get", { id: ls[0]!.slug });
  assert.equal(res.statusCode, 200, res.body);

  const [row] = await db.select().from(lessons).where(eq(lessons.slug, ls[0]!.slug));
  const [version] = await db.select().from(lessonVersions).where(eq(lessonVersions.id, row!.currentVersionId!));
  const stepRows = await db.select({ id: steps.id, idx: steps.idx }).from(steps).where(eq(steps.lessonVersionId, version!.id)).orderBy(asc(steps.idx));

  const body = out(res);
  assert.equal(body.kind, "scrim");
  assert.deepEqual(body.part.segments.map((s: { gate?: string }) => s.gate), [undefined, stepRows[0]!.id, stepRows[1]!.id, undefined]);
  assertOmitted(res.json(), [
    "GEN_ANSWER_OPTION_PRIVATE",
    "GEN_ANSWER_OPTION_TWO_PRIVATE",
    "GEN_HINT_PRIVATE",
    "GEN_HINT_TWO_PRIVATE",
    "GEN_WORKED_EXAMPLE_PRIVATE",
    "LAB_HIDDEN_EXPECTED_PRIVATE",
    "LAB_HIDDEN_STDIN_PRIVATE",
    '"options"',
    '"answer"',
    '"hints"',
  ]);
});

test("validatePart keeps a well-formed generated scrim and its steps", () => {
  const part = validatePart(structuredClone(scrimDraft));
  assert.equal(part.kind, "scrim");
  assert.equal("steps" in part && part.steps.length, 2);
});

test("validatePart rejects a generated scrim whose gate points past its steps", () => {
  const bad = withSegments([
    { text: "Here is add.", durationMs: 1500 },
    { text: "Predict.", durationMs: 2000, gate: 0 },
    { text: "Predict again.", durationMs: 1800, gate: 2 },
    { text: "Now the lab.", durationMs: 1000 },
  ]);
  assert.throws(() => validatePart(bad), /has no step/);
});

test("validatePart rejects a generated scrim with a step that no segment gates", () => {
  const bad = withSegments([
    { text: "Here is add.", durationMs: 1500 },
    { text: "Predict.", durationMs: 2000, gate: 0 },
    { text: "Now the lab.", durationMs: 1000 },
  ]);
  assert.throws(() => validatePart(bad), /step 1 has no gate segment/);
});

test("validatePart rejects a generated scrim that gates one step twice", () => {
  const bad = withSegments([
    { text: "Here is add.", durationMs: 1500 },
    { text: "Predict.", durationMs: 2000, gate: 0 },
    { text: "Predict again.", durationMs: 1800, gate: 0 },
    { text: "Now the lab.", durationMs: 1000 },
  ]);
  assert.throws(() => validatePart(bad), /gates must be unique/);
});
