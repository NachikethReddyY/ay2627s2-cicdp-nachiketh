import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissJob, getJob, getQueue, startGeneration } from "./generationJob.ts";

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

test("a request that never answers shows TIMEOUT, and a retry is queued until the abandon window ends", async () => {
  let calls = 0;
  void startGeneration("rust", () => (calls++, new Promise(() => undefined)), { timeoutMs: 10, abandonMs: 40 });
  await wait(20);
  assert.deepEqual(getJob(), { status: "failed", prompt: "rust", code: "TIMEOUT", pending: true });

  await startGeneration("rust", async () => (calls++, { firstCourseSlug: "rust-basics" }), { timeoutMs: 10, abandonMs: 40 });
  assert.equal(calls, 1, "no second request while the first may still finish");
  assert.deepEqual(getQueue(), ["rust"]);

  await wait(50);
  assert.deepEqual(getJob(), { status: "failed", prompt: "rust", code: "TIMEOUT", pending: false });
  dismissJob();
  assert.equal(calls, 2, "the queued retry starts once the timed-out job has been seen");
  await wait(0);
  assert.deepEqual(getJob(), { status: "done", prompt: "rust", courseSlug: "rust-basics" });
  dismissJob();
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

test("a start while one is running is queued, not sent, and waits for the learner to see the job before it", async () => {
  const sent: string[] = [];
  let finish!: (r: { firstCourseSlug: string }) => void;
  const first = startGeneration("rust", () => new Promise((resolve) => { finish = resolve; }));
  void startGeneration("python", async () => (sent.push("python"), { firstCourseSlug: "python-basics" }));
  assert.deepEqual(getJob(), { status: "running", prompt: "rust" });
  assert.deepEqual(getQueue(), ["python"]);
  assert.deepEqual(sent, []);

  finish({ firstCourseSlug: "rust-basics" });
  await first;
  assert.deepEqual(sent, [], "the queued prompt waits while the finished job is unseen");
  assert.equal(getJob().status, "done");

  dismissJob();
  assert.deepEqual(sent, ["python"]);
  assert.deepEqual(getQueue(), []);
  assert.deepEqual(getJob(), { status: "running", prompt: "python" });
  await wait(0);
  assert.deepEqual(getJob(), { status: "done", prompt: "python", courseSlug: "python-basics" });
});

test("queued prompts run one at a time, in the order they were submitted", async () => {
  const order: string[] = [];
  const quick = (name: string) => async () => (order.push(name), { firstCourseSlug: `${name}-basics` });
  let finish!: (r: { firstCourseSlug: string }) => void;
  void startGeneration("first", () => new Promise((resolve) => { finish = resolve; }));
  void startGeneration("second", quick("second"));
  void startGeneration("third", quick("third"));
  assert.deepEqual(getQueue(), ["second", "third"]);

  finish({ firstCourseSlug: "first-basics" });
  await wait(0);
  dismissJob();
  assert.deepEqual(order, ["second"]);
  assert.deepEqual(getQueue(), ["third"]);
  await wait(0);
  dismissJob();
  assert.deepEqual(order, ["second", "third"]);
  assert.deepEqual(getQueue(), []);
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
