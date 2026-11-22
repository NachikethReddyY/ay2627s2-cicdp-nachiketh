import { signUp, trpc, out } from "./helpers.ts";
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { db } from "../src/db/client.ts";
import { checkResults, lessons, lessonVersions, partCompletions, practiceAttempts, worlds, type PartSecret } from "../src/db/schema.ts";
import { parsePractice } from "../src/parts/practice-schema.ts";
import { verifyReferenceSolution } from "../src/sandbox/check.ts";
import { setCheckSpawnForTests } from "../src/sandbox/dockerChecks.ts";
import { setBackend } from "../src/sandbox/backend.ts";
import { atCapacity, startRun, stopRun } from "../src/sandbox/run.ts";

const app = buildApp();
after(() => app.close());
afterEach(() => { setCheckSpawnForTests(); setBackend(null); });

type Test = { id: string; name: string; stdin?: string; expectedStdout: string; visibility: "sample" | "hidden"; stretch?: boolean };
const tests: Test[] = [
  { id: "s1", name: "Sample sum", stdin: "2 3", expectedStdout: "5", visibility: "sample" },
  { id: "h1", name: "Hidden sum", stdin: "HIDDEN-IN", expectedStdout: "HIDDEN-OUT", visibility: "hidden" },
  { id: "b1", name: "Bonus", stdin: "BONUS-IN", expectedStdout: "BONUS-OUT", visibility: "hidden", stretch: true },
];
const part = (t: Test[] = tests): Extract<PartSecret, { kind: "practice" }> => ({ kind: "practice", instructions: "Add two numbers.", language: "python", starterCode: "# code", tests: t });

async function addLesson(slug: string, kind: "practice" | "learn" | "scrim", content: PartSecret, status: "published" | "draft" = "published") {
  const [world] = await db.select().from(worlds).where(eq(worlds.slug, "codequest"));
  const [lesson] = await db.insert(lessons).values({ slug, title: slug, worldId: world!.id, sourceKind: "authored", kind, status }).returning();
  const [version] = await db.insert(lessonVersions).values({ lessonId: lesson!.id, version: 1, content }).returning();
  await db.update(lessons).set({ currentVersionId: version!.id }).where(eq(lessons.id, lesson!.id));
  return lesson!.id;
}

function fakeDocker(pass: boolean[], calls: { stdin: string[] } = { stdin: [] }, beforeResult: () => Promise<void> = async () => {}) {
  setCheckSpawnForTests(((_c: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = Object.assign(new EventEmitter(), {
      end(s: string) {
        if (args[0] !== "run") return;
        calls.stdin.push(s);
        const n = (JSON.parse(s) as { tests: unknown[] }).tests.length;
        const results = Array.from({ length: n }, (_, i) => ({ exit: 0, timedOut: false, overflow: false, stdout: pass[i] ? ["5", "HIDDEN-OUT", "BONUS-OUT"][i] : "wrong", stderr: "" }));
        void beforeResult().then(() => {
          setImmediate(() => {
            (child.stdout as EventEmitter).emit("data", Buffer.from(JSON.stringify({ token: (JSON.parse(s) as { token: string }).token, results }) + "\n"));
            child.emit("close", 0);
          });
        }, () => child.emit("close", 1));
      },
    });
    if (args[0] !== "run") setImmediate(() => child.emit("close", 0));
    return child;
  }) as never);
  return calls;
}

const check = (cookie: string, payload: object) =>
  app.inject({ method: "POST", url: "/api/sandbox/check", headers: { cookie, origin: env.PUBLIC_ORIGIN }, payload });
const body = (lessonId: string, over: object = {}) => ({ code: "print(1)", language: "python", lessonId, ...over });

async function withSandbox<T>(enabled: boolean, fn: () => Promise<T>) {
  const was = env.SANDBOX_ENABLED;
  env.SANDBOX_ENABLED = enabled;
  try { return await fn(); } finally { env.SANDBOX_ENABLED = was; }
}

test("lessons.get: hidden tests leak no stdin, expected output or answers; sample tests show both", async () => {
  const cookie = await signUp(app, "reader@example.com");
  await addLesson("multi", "practice", part());
  const res = await trpc(app, cookie).q("lessons.get", { id: "multi" });
  assert.equal(res.statusCode, 200, res.body);
  const p = out(res).part;
  assert.deepEqual(p.tests, [
    { id: "s1", name: "Sample sum", visibility: "sample", stretch: false, stdin: "2 3", expectedStdout: "5" },
    { id: "h1", name: "Hidden sum", visibility: "hidden", stretch: false },
    { id: "b1", name: "Bonus", visibility: "hidden", stretch: true },
  ]);
  const hidden = p.tests.filter((t: { visibility: string }) => t.visibility === "hidden");
  for (const t of hidden) assert.deepEqual(Object.keys(t).sort(), ["id", "name", "stretch", "visibility"]);
  for (const leak of ["HIDDEN-IN", "HIDDEN-OUT", "BONUS-IN", "BONUS-OUT", "expectedOutput"]) assert.ok(!res.body.includes(leak), leak);
  assert.equal(p.language, "python");
});

test("lessons.get: a legacy lesson becomes one hidden test and keeps its output secret", async () => {
  const cookie = await signUp(app, "legacy@example.com");
  await addLesson("legacy", "practice", { kind: "practice", instructions: "Print 42.", language: "typescript", starterCode: "", expectedOutput: "THE-ANSWER" });
  const res = await trpc(app, cookie).q("lessons.get", { id: "legacy" });
  const p = out(res).part;
  assert.equal(p.language, "typescript");
  assert.equal(p.solution, null);
  assert.equal((await trpc(app, cookie).m("lessons.revealPracticeSolution", { id: "legacy", versionId: p.versionId, revision: p.revision })).statusCode, 404);
  assert.deepEqual(p.tests, [{ id: "legacy", name: "Expected output", visibility: "hidden", stretch: false }]);
  assert.ok(!res.body.includes("THE-ANSWER"));
});

test("a reference solution unlocks after three checked submissions for the same learner and lesson version", async () => {
  const cookie = await signUp(app, "solver@example.com");
  const otherCookie = await signUp(app, "other@example.com");
  const referenceSolution = "print(sum(map(int, input().split())))";
  const content = { ...part(), referenceSolution };
  const lessonId = await addLesson("multi", "practice", content);
  const current = () => trpc(app, cookie).q("lessons.get", { id: "multi" });
  const [initial, other] = await Promise.all([current(), trpc(app, otherCookie).q("lessons.get", { id: "multi" })]);
  assert.ok(!initial.body.includes(referenceSolution));
  assert.equal(out(other).part.solution.attemptCount, 0);
  const { versionId, revision, solution } = out(initial).part;
  assert.deepEqual(solution, { attemptCount: 0, unlockAt: 3, gated: false });
  const reveal = (session = cookie, version = versionId, token = revision) =>
    trpc(app, session).m("lessons.revealPracticeSolution", { id: "multi", versionId: version, revision: token });
  assert.equal((await reveal("")).statusCode, 401);
  assert.equal((await reveal()).statusCode, 403);

  const calls = fakeDocker([false, false, false]);
  await withSandbox(true, async () => {
    assert.equal((await check("", body("multi", { versionId, attemptCount: 999 }))).statusCode, 401);
    assert.equal((await check(cookie, body("multi", { code: "  ", versionId }))).statusCode, 400);
    assert.equal((await check(cookie, body("multi", { language: "javascript", versionId }))).statusCode, 400);
    for (let count = 1; count <= 3; count++) {
      const response = await check(cookie, body("multi", { versionId, attemptCount: 999 }));
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().attemptCount, count);
      assert.ok(!response.body.includes(referenceSolution));
      if (count < 3) assert.equal((await reveal()).statusCode, 403);
    }
    assert.equal(calls.stdin.length, 3);
    fakeDocker([true, true, true], undefined, async () => {
      await db.update(lessons).set({ status: "archived" }).where(eq(lessons.id, lessonId));
    });
    assert.equal((await withSandbox(false, reveal)).statusCode, 503);
    assert.equal((await reveal()).statusCode, 404);
    await db.update(lessons).set({ status: "published" }).where(eq(lessons.id, lessonId));
    fakeDocker([true, true, true]);
    assert.deepEqual(out(await reveal()), { code: referenceSolution });
    assert.equal((await reveal(otherCookie)).statusCode, 403);
    const reloaded = await current();
    assert.equal(out(reloaded).part.solution.attemptCount, 3);
    assert.ok(!reloaded.body.includes(referenceSolution));

    await db.update(lessonVersions).set({ content: { ...content, instructions: "Add two integers." } }).where(eq(lessonVersions.id, versionId));
    const changed = out(await current()).part;
    assert.equal(changed.versionId, versionId);
    assert.equal(changed.solution.attemptCount, 0);
    assert.notEqual(changed.revision, revision);
    assert.equal((await reveal()).statusCode, 409);
    assert.equal((await reveal(cookie, changed.versionId, changed.revision)).statusCode, 403);
    assert.equal((await check(cookie, body("multi", { versionId, revision }))).statusCode, 409);

    const [next] = await db.insert(lessonVersions).values({ lessonId, version: 2, content }).returning();
    await db.update(lessons).set({ currentVersionId: next.id }).where(eq(lessons.id, lessonId));
    const updated = out(await current()).part;
    assert.equal(updated.solution.attemptCount, 0);
    assert.equal((await reveal()).statusCode, 404);
    assert.equal((await reveal(cookie, next.id, updated.revision)).statusCode, 403);
    assert.equal((await check(cookie, body("multi", { versionId }))).statusCode, 409);
  });
});

test("reference solutions must pass every test, including bonus tests, without counting as a submission", async () => {
  const referenceSolution = "print(sum(map(int, input().split())))";
  const practice = parsePractice({ ...part(), referenceSolution });
  await withSandbox(true, async () => {
    fakeDocker([true, true, false]);
    assert.equal(await verifyReferenceSolution(practice), "invalid");
    const calls = fakeDocker([true, true, true]);
    assert.equal(await verifyReferenceSolution(practice), "valid");
    assert.equal(JSON.parse(calls.stdin[0]!).code, referenceSolution);
    assert.equal((await db.select().from(practiceAttempts)).length, 0);
  });
});

test("a passing submission cannot update progress if the lesson changes during grading", async () => {
  const cookie = await signUp(app);
  const lessonId = await addLesson("revision-race", "practice", part());
  fakeDocker([true, true, true], undefined, async () => {
    const [next] = await db.insert(lessonVersions).values({ lessonId, version: 2, content: part() }).returning();
    await db.update(lessons).set({ currentVersionId: next.id }).where(eq(lessons.id, lessonId));
  });
  const result = await withSandbox(true, () => check(cookie, body("revision-race")));
  assert.equal(result.statusCode, 409, result.body);
  assert.equal((await db.select().from(practiceAttempts)).length, 0);
  assert.equal((await db.select().from(partCompletions)).length, 0);
  assert.equal((await db.select().from(checkResults)).length, 0);
});

test("POST /sandbox/check: 503 when the sandbox is disabled", async () => {
  const cookie = await signUp(app);
  await addLesson("multi", "practice", part());
  const res = await withSandbox(false, () => check(cookie, body("multi")));
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, "unavailable");
});

test("POST /sandbox/check: 401 signed out, 400 bad body, 404 for a lesson that is not a visible published practice lesson", async () => {
  const cookie = await signUp(app);
  await addLesson("learn-1", "learn", { kind: "learn", body: "Read." });
  await addLesson("draft-prac", "practice", part(), "draft");
  await addLesson("multi", "practice", part());
  fakeDocker([true, true, true]);
  await withSandbox(true, async () => {
    assert.equal((await check("", body("multi"))).statusCode, 401);
    assert.equal((await check(cookie, { code: 1 })).statusCode, 400);
    assert.equal((await check(cookie, body("multi", { language: "ruby" }))).statusCode, 400);
    assert.equal((await check(cookie, body("multi", { code: "x".repeat(20_001) }))).statusCode, 400);
    for (const lessonId of ["learn-1", "draft-prac", "nope"]) assert.equal((await check(cookie, body(lessonId))).statusCode, 404, lessonId);
  });
  assert.equal((await db.select().from(partCompletions)).length, 0);
  assert.equal((await db.select().from(checkResults)).length, 0);
});

test("POST /sandbox/check: scores, hides hidden tests, and records completion only when every required test passes", async () => {
  const cookie = await signUp(app);
  const lessonId = await addLesson("multi", "practice", part());
  const calls = fakeDocker([true, false, true]);
  await withSandbox(true, async () => {
    const res = await check(cookie, body("multi"));
    assert.equal(res.statusCode, 200, res.body);
    const r = res.json();
    assert.deepEqual(r.required, { passed: 1, total: 2 });
    assert.deepEqual(r.stretch, { passed: 1, total: 1 });
    assert.deepEqual([r.points, r.maxPoints, r.complete], [2, 3, false]);
    assert.deepEqual(r.best, { points: 2, maxPoints: 3 });
    assert.deepEqual(r.results[0], { id: "s1", name: "Sample sum", stretch: false, visibility: "sample", status: "pass", stdin: "2 3", expectedStdout: "5", actualStdout: "5" });
    assert.deepEqual(r.results[1], { id: "h1", name: "Hidden sum", stretch: false, visibility: "hidden", status: "fail" });
    assert.deepEqual(r.results[2], { id: "b1", name: "Bonus", stretch: true, visibility: "hidden", status: "pass" });
    for (const leak of ["HIDDEN-IN", "HIDDEN-OUT", "BONUS-IN", "BONUS-OUT", "wrong"]) assert.ok(!res.body.includes(leak), leak);
    assert.equal((await db.select().from(partCompletions)).length, 0, "incomplete: no completion");
    assert.equal(JSON.parse(calls.stdin[0]!).tests[1].stdin, "HIDDEN-IN", "the container does get the hidden stdin");

    fakeDocker([false, false, false]);
    const worse = (await check(cookie, body("multi"))).json();
    assert.deepEqual([worse.points, worse.best.points], [0, 2]);

    fakeDocker([true, true, false]);
    const done = (await check(cookie, body("multi"))).json();
    assert.deepEqual([done.complete, done.points, done.best.points], [true, 2, 2]);
    assert.equal((await db.select().from(partCompletions)).length, 1);

    fakeDocker([true, true, true]);
    const full = (await check(cookie, body("multi"))).json();
    assert.deepEqual([full.points, full.best], [3, { points: 3, maxPoints: 3 }]);
    assert.equal((await db.select().from(partCompletions)).length, 1);

    fakeDocker([false, false, false]);
    assert.deepEqual((await check(cookie, body("multi"))).json().best, { points: 3, maxPoints: 3 });
  });
  const [row] = await db.select().from(checkResults);
  assert.equal(row!.lessonId, lessonId);
  assert.deepEqual([row!.bestPoints, row!.maxPoints, row!.complete], [3, 3, true]);
});

test("POST /sandbox/check: a harness that reports nothing usable is a 503, never a pass", async () => {
  const cookie = await signUp(app);
  await addLesson("multi", "practice", part());
  setCheckSpawnForTests((() => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = Object.assign(new EventEmitter(), { end() { setImmediate(() => child.emit("close", 1)); } });
    return child;
  }) as never);
  await withSandbox(true, async () => {
    const res = await check(cookie, body("multi"));
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.message, "Could not check the code");
    assert.equal((await db.select().from(practiceAttempts)).length, 0);
  });
  assert.equal((await db.select().from(partCompletions)).length, 0);
  assert.equal((await db.select().from(checkResults)).length, 0);
});

test("POST /sandbox/check: a result line without the matching token, such as one forged by learner code, is a 503 and no pass", async () => {
  const cookie = await signUp(app);
  await addLesson("multi", "practice", part());
  const rows = [{ exit: 0, timedOut: false, overflow: false, stdout: "5", stderr: "" }, { exit: 0, timedOut: false, overflow: false, stdout: "HIDDEN-OUT", stderr: "" }, { exit: 0, timedOut: false, overflow: false, stdout: "BONUS-OUT", stderr: "" }];
  for (const line of [{ results: rows }, { token: "forged", results: rows }]) {
    setCheckSpawnForTests((() => {
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      child.stdin = Object.assign(new EventEmitter(), {
        end() { setImmediate(() => { (child.stdout as EventEmitter).emit("data", Buffer.from(JSON.stringify(line) + "\n")); child.emit("close", 0); }); },
      });
      return child;
    }) as never);
    await withSandbox(true, async () => {
      const res = await check(cookie, body("multi"));
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error.code, "check_failed");
    });
  }
  assert.equal((await db.select().from(partCompletions)).length, 0);
  assert.equal((await db.select().from(checkResults)).length, 0);
});

test("POST /sandbox/check: a passing line with the right token is still a 503 when docker exits non-zero (killed, 137)", async () => {
  const cookie = await signUp(app);
  await addLesson("multi", "practice", part());
  setCheckSpawnForTests((() => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = Object.assign(new EventEmitter(), {
      end(s: string) {
        const { token } = JSON.parse(s) as { token: string };
        const rows = [{ exit: 0, timedOut: false, overflow: false, stdout: "5", stderr: "" }, { exit: 0, timedOut: false, overflow: false, stdout: "HIDDEN-OUT", stderr: "" }, { exit: 0, timedOut: false, overflow: false, stdout: "BONUS-OUT", stderr: "" }];
        setImmediate(() => { (child.stdout as EventEmitter).emit("data", Buffer.from(JSON.stringify({ token, results: rows }) + "\n")); child.emit("close", 137); });
      },
    });
    return child;
  }) as never);
  await withSandbox(true, async () => {
    const res = await check(cookie, body("multi"));
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(res.json().error.code, "check_failed");
  });
  assert.equal((await db.select().from(partCompletions)).length, 0);
  assert.equal((await db.select().from(checkResults)).length, 0);
});

test("the legacy POST /sandbox/run Check path still reads expectedOutput", async () => {
  const { practiceCheck } = await import("../src/parts/practice.ts");
  const cookie = await signUp(app);
  await addLesson("legacy", "practice", { kind: "practice", instructions: "Print 42.", starterCode: "", expectedOutput: "42" });
  await addLesson("multi", "practice", part());
  await trpc(app, cookie).q("home.get");
  const me = (await db.execute<{ id: string }>(sql`SELECT id FROM learners`)).rows[0]!.id;
  assert.equal((await practiceCheck(me, "legacy"))?.expected, "42");
  assert.equal(await practiceCheck(me, "multi"), null, "a multi-test lesson has no single expected output");
});

test("a live check and a live run share SANDBOX_MAX_RUNS: with 2, the next check and the next run are both busy (503)", async () => {
  const cookieA = await signUp(app, "cap-a@example.com");
  const cookieB = await signUp(app, "cap-b@example.com");
  await addLesson("multi", "practice", part());
  let finishCheck = () => {};
  setCheckSpawnForTests(((_c: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin = Object.assign(new EventEmitter(), { end() { if (args[0] === "run") finishCheck = () => child.emit("close", 1); } });
    if (args[0] !== "run") setImmediate(() => child.emit("close", 0));
    return child;
  }) as never);
  const runSpawn = () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { write() {} });
    child.kill = () => { setImmediate(() => child.emit("close", 137)); };
    return child as never;
  };
  const max = env.SANDBOX_MAX_RUNS;
  env.SANDBOX_MAX_RUNS = 2;
  let runId: string | null = null;
  try {
    await withSandbox(true, async () => {
      const first = check(cookieA, body("multi"));
      for (let i = 0; i < 200 && !atCapacity() && finishCheck.toString() === "() => {}"; i++) await new Promise((r) => setTimeout(r, 10));
      runId = startRun("print(1)", "cap-run-learner", "python", runSpawn);
      assert.ok(runId, "one check plus one run fits in 2");
      assert.equal(atCapacity(), true);
      const next = await check(cookieB, body("multi"));
      assert.equal(next.statusCode, 503);
      assert.equal(next.json().error.code, "busy");
      const nextRun = await app.inject({ method: "POST", url: "/api/sandbox/run", headers: { cookie: cookieB, origin: env.PUBLIC_ORIGIN }, payload: { code: "print(2)", language: "python" } });
      assert.equal(nextRun.statusCode, 503);
      assert.equal(nextRun.json().error.code, "busy");
      finishCheck();
      await first;
    });
  } finally {
    if (runId) stopRun(runId, "cap-run-learner");
    await new Promise((r) => setTimeout(r, 20));
    env.SANDBOX_MAX_RUNS = max;
  }
  assert.equal(atCapacity(), false, "the check released its slot");
});


test("scrim lab is checked as practice and cannot be completed directly", async () => {
  const { practiceCheck, practiceTests } = await import("../src/parts/practice.ts");
  const cookie = await signUp(app);
  const lab = { kind: "practice" as const, instructions: "Print 42.", starterCode: "", expectedOutput: "42" };
  await addLesson("scrim-lab", "scrim", { kind: "scrim", language: "python", segments: [{ text: "Predict", durationMs: 500 }], lab });
  await trpc(app, cookie).q("home.get");
  const me = (await db.execute<{ id: string }>(sql`SELECT id FROM learners`)).rows[0]!.id;
  assert.equal((await practiceCheck(me, "scrim-lab"))?.expected, "42");
  assert.equal((await practiceTests(me, "scrim-lab"))?.practice.tests[0]?.expectedStdout, "42");
  assert.equal((await trpc(app, cookie).m("parts.complete", { lessonId: "scrim-lab" })).statusCode, 403);
});


test("check and reference verification use the configured backend and authored language", async () => {
  const cookie = await signUp(app);
  await addLesson("backend-check", "practice", part());
  const calls: string[] = [];
  setBackend({
    openShell: () => Promise.reject(new Error("unexpected shell")),
    runChecks: async (code, language, tests) => {
      calls.push(`${language}:${code}`);
      return tests.map((t) => ({ exit: 0, timedOut: false, overflow: false, stdout: t.expectedStdout, stderr: "" }));
    },
  });
  await withSandbox(true, async () => {
    assert.equal((await check(cookie, body("backend-check", { language: "javascript" }))).statusCode, 400);
    assert.equal((await check(cookie, { lessonId: "backend-check", code: "print(1)" })).statusCode, 200);
    const practice = parsePractice({ ...part(), referenceSolution: "print(5)" });
    assert.equal(await verifyReferenceSolution(practice), "valid");
    assert.deepEqual(calls, ["python:print(1)", "python:print(5)"]);
  });
});
