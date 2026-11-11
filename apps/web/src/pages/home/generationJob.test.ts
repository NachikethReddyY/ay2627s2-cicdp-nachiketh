import { test } from "node:test";
import assert from "node:assert/strict";
import { dismissJob, getJob, startGeneration } from "./generationJob.ts";

test("a finished job keeps its course slug", async () => {
  await startGeneration("rust", async () => ({ firstCourseSlug: "rust-basics" }));
  assert.deepEqual(getJob(), { status: "done", prompt: "rust", courseSlug: "rust-basics" });
});

test("a tRPC error keeps its code so the page can explain it", async () => {
  await startGeneration("baking", async () => {
    throw Object.assign(new Error("refused"), { data: { code: "BAD_REQUEST" } });
  });
  assert.deepEqual(getJob(), { status: "failed", prompt: "baking", code: "BAD_REQUEST" });
});

test("a request that never answers fails with TIMEOUT instead of spinning", async () => {
  await startGeneration("rust", () => new Promise(() => undefined), 10);
  assert.deepEqual(getJob(), { status: "failed", prompt: "rust", code: "TIMEOUT" });
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
