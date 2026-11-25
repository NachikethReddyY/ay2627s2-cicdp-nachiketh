import { code, out, readSteps, signUp, trpc } from "./helpers.ts";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { runPathBuildBatch } from "../src/ai/path-build-worker.ts";
import { LESSON_WRITE_CONCURRENCY } from "../src/ai/service.ts";
import { buildApp } from "../src/app.ts";
import { db } from "../src/db/client.ts";
import { engineParts } from "../src/engine-client/parts.ts";
import { env } from "../src/env.ts";

const app = buildApp();
const variables = { id: "variables", title: "Variables" };
const scope = { id: "scope", title: "Lexical scope" };
const layout = {
  title: "JavaScript variables and scope",
  tagline: "Trace where values come from",
  startingPoint: "Read a line of JavaScript.",
  destination: "Explain which value a block reads.",
  topics: [
    { ...variables, outcome: "Trace a binding", prerequisites: [] },
    { ...scope, outcome: "Trace a local binding", prerequisites: ["variables"] },
  ],
  sections: [
    { title: "Bindings", description: "Read and update bindings.", units: [{ topicId: variables.id, lessonCount: 1 }] },
    { title: "Visibility", description: "Use bindings inside a block.", units: [{ topicId: scope.id, lessonCount: 4 }] },
  ],
};

const learned = (concepts: string[]) => ({
  kind: "learn",
  intro: "A binding gives a value a name.",
  workedExample: { code: "const rate = 3;", explanation: "The name rate holds the number three." },
  body: "A binding connects a name to a value. Look for where it was first declared.",
  steps: readSteps.map((step) => ({ ...step, concepts })),
});
const practice = { kind: "practice", instructions: "Print the value of a binding.", starterCode: "const x = 2;", expectedOutput: "2" };

type BatchRequest = { topic: string; offset: number; count: number };
let planned = layout;
let requested = [variables, scope];
let rejectOffset: number | null = null;
let starts: string[] = [];
let batches: BatchRequest[] = [];
const engine = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
  request.on("end", () => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/pipeline/roadmap-topics") return response.end(JSON.stringify({ plan: { topics: requested } }));
    if (request.url === "/v1/pipeline/roadmap") return response.end(JSON.stringify({ plan: planned }));
    const input = JSON.parse(body) as BatchRequest;
    batches.push(input);
    if (rejectOffset === input.offset) {
      response.statusCode = 503;
      return response.end("{}");
    }
    const lessons = Array.from({ length: input.count }, (_, i) => {
      const ordinal = input.offset + i;
      return { title: `${input.topic} lesson ${ordinal + 1}`, objective: `Apply ${input.topic} in example ${ordinal + 1}`, kind: ordinal === 0 ? "learn" : "practice" };
    });
    response.end(JSON.stringify({ plan: { lessons } }));
  });
});

before(async () => {
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve));
  env.ENGINE_URL = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => engine.close((error) => error ? reject(error) : resolve()));
  await app.close();
});

beforeEach(() => {
  env.ENGINE_TOKEN = "t".repeat(32);
  env.AI_WRITE_COURSE_ON_GENERATE = true;
  planned = layout;
  requested = [variables, scope];
  rejectOffset = null;
  starts = [];
  batches = [];
  engineParts.lesson = async ({ lesson }) => {
    starts.push(lesson.title);
    return lesson.kind === "learn" ? learned(lesson.concepts) : practice;
  };
});

async function generate(email = "course-build@example.com") {
  const t = trpc(app, await signUp(app, email));
  const res = await t.m("paths.generate", { prompt: "JavaScript variables and scope" });
  assert.equal(res.statusCode, 200, res.body);
  const { slug } = out(res);
  const roadmap = async () => out(await t.q("paths.get", { slug }));
  return { t, slug, roadmap };
}

async function drain() {
  while (await runPathBuildBatch()) { }
}

test("Home lists the pending path, then the full roadmap appears before any lesson can be opened", async () => {
  const { t, slug, roadmap } = await generate();
  assert.equal((await roadmap()).build.state, "planning");
  assert.equal(out(await t.q("home.get")).paths.find((path: { slug: string }) => path.slug === slug).building, true);
  assert.equal(out(await t.q("home.get")).continue, null);

  assert.equal(await runPathBuildBatch(), 1);
  const plan = await roadmap();
  assert.deepEqual(plan.build, { state: "building", ready: 0, total: 5 });
  assert.deepEqual(plan.sections.map(({ title }: { title: string }) => title), ["Bindings", "Visibility"]);
  assert.deepEqual(plan.roadmap.topics.map(({ title }: { title: string }) => title), ["Variables", "Lexical scope"]);
  const first = plan.sections[0].lessons[0].slug;
  assert.equal(code(await t.q("courses.get", { slug: plan.sections[0].slug })), "PRECONDITION_FAILED");
  assert.equal(code(await t.m("paths.publish", { slug })), "PRECONDITION_FAILED");
  assert.equal(code(await t.q("lessons.get", { id: first })), "NOT_FOUND");
  assert.equal(code(await t.m("lessons.write", { id: first })), "NOT_FOUND");

  assert.equal(await runPathBuildBatch(), LESSON_WRITE_CONCURRENCY);
  assert.deepEqual((await roadmap()).build, { state: "building", ready: 3, total: 5 });
  assert.equal(code(await t.q("lessons.get", { id: first })), "NOT_FOUND");

  await drain();
  assert.deepEqual((await roadmap()).build, { state: "ready", ready: 5, total: 5 });
  const section = out(await t.q("courses.get", { slug: plan.sections[0].slug, path: slug }));
  assert.equal(section.nextSection, plan.sections[1].slug);
  const response = await t.q("lessons.get", { id: first });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(out(response).learnIntro, /const rate = 3/);
  assert.doesNotMatch(response.body, /READ_ANSWER_OPTION_PRIVATE/);
});

test("validates requested topics and prerequisites before enqueuing lessons", async () => {
  requested = [...requested, { id: "object-spread", title: "Object spread" }];
  const { roadmap } = await generate();
  await runPathBuildBatch();
  assert.equal((await roadmap()).sections.length, 0);
  assert.equal(batches.length, 0);
  requested = [variables, scope];
  planned = { ...layout, sections: [...layout.sections].reverse() };
  await db.execute(sql`UPDATE path_build_jobs SET checkpoint = NULL, available_at = now()`);
  await runPathBuildBatch();
  assert.equal((await roadmap()).sections.length, 0);
  assert.equal(batches.length, 0);
});

test("plans 205 lessons in one section, resumes a failed batch, and keeps different topic levels", async () => {
  planned = {
    ...layout,
    sections: [{ ...layout.sections[0]!, units: [{ topicId: variables.id, lessonCount: 205 }, { topicId: scope.id, lessonCount: 1 }] }],
  };
  rejectOffset = 12;
  const { roadmap } = await generate();
  await runPathBuildBatch();
  assert.equal((await roadmap()).sections.length, 0);
  assert.deepEqual(batches.map((batch) => batch.offset), [0, 12]);

  rejectOffset = null;
  await db.execute(sql`UPDATE path_build_jobs SET available_at = now()`);
  await runPathBuildBatch();
  const plan = await roadmap();
  assert.equal(plan.build.total, 206);
  assert.equal(plan.sections[0].lessons[204].level, 1);
  assert.equal(plan.sections[0].lessons[205].level, 2);
  assert.equal(batches.filter((batch) => batch.topic === variables.title && batch.offset === 0).length, 1);
  assert.ok(batches.every((batch) => batch.count <= 12));
});

test("reclaims an expired lease and never writes a second version after recovery", async () => {
  const { roadmap } = await generate();
  await runPathBuildBatch();
  await runPathBuildBatch();
  const { rows: [job] } = await db.execute<{ id: string }>(sql`SELECT id FROM path_build_jobs WHERE lesson_id IS NOT NULL AND state = 'ready' LIMIT 1`);
  await db.execute(sql`UPDATE path_build_jobs SET state = 'writing', lease_until = now() - interval '1 second', lease_token = 'dead-worker' WHERE id = ${job.id}`);
  await drain();
  assert.equal((await roadmap()).build.state, "ready");
  assert.equal(starts.length, 5);
  const { rows } = await db.execute(sql`SELECT 1 FROM lesson_versions v JOIN path_build_jobs j ON j.lesson_id = v.lesson_id WHERE j.id = ${job.id}`);
  assert.equal(rows.length, 1);
});

test("multiple worker claims respect the global limit and an owner can retry a paused build", async () => {
  const { t, slug, roadmap } = await generate();
  await runPathBuildBatch();
  let running = 0;
  let peak = 0;
  engineParts.lesson = async ({ lesson }) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 30));
    running--;
    return lesson.kind === "learn" ? learned(lesson.concepts) : practice;
  };
  await Promise.all([runPathBuildBatch(), runPathBuildBatch()]);
  assert.equal(peak, LESSON_WRITE_CONCURRENCY);
  await db.execute(sql`UPDATE path_build_jobs SET state = 'failed' WHERE state = 'pending'`);
  assert.equal((await roadmap()).build.state, "failed");
  const stranger = trpc(app, await signUp(app, "build-stranger@example.com"));
  assert.equal(code(await stranger.m("paths.retryBuild", { slug })), "NOT_FOUND");
  assert.equal((await t.m("paths.retryBuild", { slug })).statusCode, 200);
  await drain();
  assert.equal((await roadmap()).build.state, "ready");
});
