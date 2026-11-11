import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissJob, getJob, startGeneration } from "./generationJob.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a finished job keeps its course slug", async () => {
  await startGeneration("rust", async () => ({ firstCourseSlug: "rust-basics" }));
  assert.deepEqual(getJob(), { status: "done", prompt: "rust", courseSlug: "rust-basics" });
});

test("a tRPC error keeps its code so the page can explain it", async () => {
  await startGeneration("baking", async () => {
    throw Object.assign(new Error("refused"), { data: { code: "BAD_REQUEST" } });
  });
  assert.deepEqual(getJob(), { status: "failed", prompt: "baking", code: "BAD_REQUEST", pending: false });
});

test("a request that never answers shows TIMEOUT, and retry waits until the abandon window ends", async () => {
  let calls = 0;
  void startGeneration("rust", () => (calls++, new Promise(() => undefined)), { timeoutMs: 10, abandonMs: 40 });
  await wait(20);
  assert.deepEqual(getJob(), { status: "failed", prompt: "rust", code: "TIMEOUT", pending: true });

  await startGeneration("rust", () => (calls++, new Promise(() => undefined)), { timeoutMs: 10, abandonMs: 40 });
  assert.equal(calls, 1, "no second request while the first may still finish");

  await wait(50);
  assert.deepEqual(getJob(), { status: "failed", prompt: "rust", code: "TIMEOUT", pending: false });
});

test("dismissJob keeps a timed-out job the server may still answer", async () => {
  void startGeneration("rust", () => new Promise(() => undefined), { timeoutMs: 10, abandonMs: 40 });
  await wait(20);
  dismissJob();
  assert.deepEqual(getJob(), { status: "failed", prompt: "rust", code: "TIMEOUT", pending: true });
  await wait(50);
  dismissJob();
  assert.deepEqual(getJob(), { status: "idle" });
});

test("a late answer after the timeout still reaches the page", async () => {
  let answer!: (r: { firstCourseSlug: string }) => void;
  const late = startGeneration("rust", () => new Promise((resolve) => { answer = resolve; }), { timeoutMs: 10, abandonMs: 1000 });
  await wait(20);
  assert.equal(getJob().status, "failed");
  answer({ firstCourseSlug: "rust-late" });
  await late;
  assert.deepEqual(getJob(), { status: "done", prompt: "rust", courseSlug: "rust-late" });
});

test("a second start while one is running does not send another request", async () => {
  let calls = 0;
  const slow = () => {
    calls++;
    return new Promise<{ firstCourseSlug: string }>((resolve) => setTimeout(() => resolve({ firstCourseSlug: "a" }), 20));
  };
  const first = startGeneration("rust", slow);
  const second = startGeneration("python", slow);
  assert.deepEqual(getJob(), { status: "running", prompt: "rust" });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(getJob().status, "done");
});

test("dismissJob clears a settled job but never a running one", async () => {
  await startGeneration("rust", async () => ({ firstCourseSlug: "rust-basics" }));
  dismissJob();
  assert.deepEqual(getJob(), { status: "idle" });

  let finish!: (r: { firstCourseSlug: string }) => void;
  const running = startGeneration("python", () => new Promise((resolve) => { finish = resolve; }));
  dismissJob();
  assert.deepEqual(getJob(), { status: "running", prompt: "python" });
  finish({ firstCourseSlug: "python-basics" });
  await running;
  assert.equal(getJob().status, "done");
});
