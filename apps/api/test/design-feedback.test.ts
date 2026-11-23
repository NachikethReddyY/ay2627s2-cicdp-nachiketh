import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import Fastify from "fastify";
import { TRPCError } from "@trpc/server";
import type { Practice } from "../src/parts/practice-schema.ts";

process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

const { designFeedbackRoutes } = await import("../src/ai/design-feedback.ts");
const { practiceRevision } = await import("../src/parts/practice.ts");
const { practiceReceipt } = await import("../src/parts/submission-receipt.ts");
const { guideRoutes } = await import("../src/dev/route.ts");
const { ENGINE_CALLS_PER_REPLY } = await import("../src/config/budget.ts");
const { env } = await import("../src/env.ts");

const code = "const x = 1;\n\nconsole.log(x);";
const practice: Practice = {
  instructions: "Write a program",
  language: "javascript",
  starterCode: "",
  referenceSolution: "console.log(42);",
  tests: [{ id: "secret", name: "Hidden", visibility: "hidden", stdin: "PRIVATE INPUT", expectedStdout: "PRIVATE OUTPUT", stretch: false }],
};
const validFinding = { focus: "naming", line: 1 };

function setup(t: TestContext, {
  currentPractice = practice,
  finding = validFinding as unknown,
  authenticated = true,
  safe = true,
  capped = false,
  versionId = "v1",
} = {}) {
  const learner = randomUUID();
  const deps = {
    resolveLearnerId: async () => authenticated ? learner : null,
    isSafeText: async (value: string) => {
      moderated.push(value);
      return safe;
    },
    reserveAiSpend: async (amount?: number) => {
      spend.push(amount);
      if (capped) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "AI budget limit reached" });
    },
  };
  const calls: { path: string; body: unknown }[] = [];
  const spend: (number | undefined)[] = [];
  const moderated: string[] = [];
  const app = Fastify();
  app.register(designFeedbackRoutes, {
    ...deps,
    practiceTests: async () => ({ lessonId: "practice", versionId, kind: "practice", practice: currentPractice }),
    callEngine: async <T,>(path: string, body: unknown) => {
      calls.push({ path, body });
      return { feedback: { finding } } as T;
    },
  });
  app.register(guideRoutes, deps);
  t.after(() => app.close());
  const revision = practiceRevision(versionId, currentPractice);
  const receipt = practiceReceipt(learner, revision, code);
  const send = (overrides = {}) => app.inject({
    method: "POST", url: "/practice/design-feedback", payload: { lessonId: "practice", code, receipt, ...overrides },
  });
  return { app, send, calls, spend, moderated, learner, revision };
}

test("reviews a graded submission, charging the shared budget and sending only source and language", async (t) => {
  const { send, calls, spend, moderated } = setup(t);
  assert.deepEqual(calls, []);
  const response = await send();
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json<{ feedback: { line: number; note: string } }>().feedback;
  assert.equal(result.line, 1);
  assert.match(result.note, /makes its role hard to infer/);
  assert.deepEqual(calls, [{ path: "/v1/guide/design-feedback", body: { code, language: "javascript" } }]);
  assert.deepEqual(spend, [env.AI_CALL_ESTIMATE_USD * ENGINE_CALLS_PER_REPLY]);
  assert.deepEqual(moderated, [code]);
});

test("requires a session and proof of submitting this source on the current lesson revision", async (t) => {
  assert.equal((await setup(t, { authenticated: false }).send()).statusCode, 401);
  const { send, calls, spend, moderated, learner, revision } = setup(t);
  for (const overrides of [
    { receipt: "0".repeat(64) },
    { receipt: practiceReceipt("other-learner", revision, code) },
    { receipt: practiceReceipt(learner, practiceRevision("older-version", practice), code) },
    { code: "const changed = 2;" },
  ]) {
    assert.equal((await send(overrides)).statusCode, 403);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(spend, []);
  assert.deepEqual(moderated, []);
});

test("honors the AI kill switch, moderation, and spending cap before generation", async (t) => {
  const killed = setup(t);
  const previous = env.AI_KILL_SWITCH;
  env.AI_KILL_SWITCH = true;
  try {
    assert.equal((await killed.send()).statusCode, 503);
    assert.deepEqual(killed.moderated, []);
    assert.deepEqual(killed.spend, []);
  } finally {
    env.AI_KILL_SWITCH = previous;
  }
  const refused = setup(t, { safe: false });
  assert.equal((await refused.send()).statusCode, 422);
  assert.deepEqual(refused.spend, []);
  const capped = setup(t, { capped: true });
  assert.equal((await capped.send()).statusCode, 429);
  for (const { calls } of [killed, refused, capped]) assert.deepEqual(calls, []);
});

test("shares the learner's request window with Sloppy", async (t) => {
  const { app, send, calls } = setup(t);
  for (let index = 0; index < 10; index++) assert.equal((await send()).statusCode, 200);
  assert.equal((await send()).statusCode, 429);
  const chat = await app.inject({ method: "POST", url: "/guide/chat", payload: {
    fileName: "main.js", projectRoot: ".", language: "javascript", code,
    messages: [{ role: "user", content: "Can you help?" }],
  } });
  assert.equal(chat.statusCode, 429);
  assert.equal(calls.length, 10);
});

test("suppresses notes that overlap protected output, input, or the reference solution", async (t) => {
  for (const currentPractice of [
    { ...practice, referenceSolution: "makes its role" },
    { ...practice, tests: practice.tests.map((entry) => ({ ...entry, stdin: "makes its role" })) },
    { ...practice, tests: practice.tests.map((entry) => ({ ...entry, expectedStdout: "makes its role" })) },
  ]) {
    const response = await setup(t, { currentPractice }).send();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { feedback: null });
  }
});

test("accepts only a supported observation and a real source line from the engine", async (t) => {
  for (const finding of [null, { focus: "naming", line: 2 }, { focus: "naming", line: 4 }]) {
    const response = await setup(t, { finding }).send();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { feedback: null });
  }
  for (const finding of [{ focus: "print(42)", line: 1 }, { ...validFinding, note: "PRIVATE OUTPUT" }]) {
    const response = await setup(t, { finding }).send();
    assert.equal(response.statusCode, 502);
    assert.doesNotMatch(response.body, /PRIVATE OUTPUT|print\(42\)/);
  }
});
