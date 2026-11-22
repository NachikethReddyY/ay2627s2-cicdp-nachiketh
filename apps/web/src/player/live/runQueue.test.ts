import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunGate, createRunQueue, withDeadline } from "./runQueue.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function oneShotRunner() {
  const gate = createRunGate();
  const log: string[] = [];
  let active = 0;
  let overlapped = false;
  const execute = async (source: string) => {
    active++;
    if (active > 1) overlapped = true;
    log.push(`start ${source}`);
    const finished = gate.wait();
    await finished;
    log.push(`end ${source}`);
    active--;
  };
  return { gate, log, execute, overlapped: () => overlapped };
}

test("queued runs execute one at a time, in the order they were queued", async () => {
  const runner = oneShotRunner();
  const run = createRunQueue(runner.execute);
  const first = run("a");
  const second = run("b");
  const third = run("c");
  await tick();
  assert.deepEqual(runner.log, ["start a"]);
  runner.gate.release();
  await first;
  await tick();
  assert.deepEqual(runner.log, ["start a", "end a", "start b"]);
  runner.gate.release();
  await second;
  await tick();
  runner.gate.release();
  await third;
  assert.deepEqual(runner.log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.equal(runner.overlapped(), false);
});

test("a run resolves only once its own execution has finished", async () => {
  const runner = oneShotRunner();
  const run = createRunQueue(runner.execute);
  let resolved = false;
  const pending = run("a").then(() => { resolved = true; });
  await tick();
  assert.equal(resolved, false);
  runner.gate.release();
  await pending;
  assert.equal(resolved, true);
});

test("a run that fails does not stop the runs queued behind it", async () => {
  const seen: string[] = [];
  const run = createRunQueue(async (job: string) => {
    seen.push(job);
    if (job === "bad") throw new Error("boom");
  });
  const bad = run("bad");
  const good = run("good");
  await assert.rejects(bad, /boom/);
  await good;
  assert.deepEqual(seen, ["bad", "good"]);
});

test("a manual run queued between two authored runs does not overlap either", async () => {
  const runner = oneShotRunner();
  const run = createRunQueue(runner.execute);
  const all = [run("authored 1"), run("manual"), run("authored 2")];
  for (let i = 0; i < 3; i++) {
    await tick();
    runner.gate.release();
  }
  await Promise.all(all);
  assert.deepEqual(runner.log.filter((l) => l.startsWith("start")), ["start authored 1", "start manual", "start authored 2"]);
  assert.equal(runner.overlapped(), false);
});

test("releasing a gate nobody waits on does nothing, and a new wait supersedes an old one", async () => {
  const gate = createRunGate();
  gate.release();
  let first = false;
  void gate.wait().then(() => { first = true; });
  let second = false;
  const waiting = gate.wait().then(() => { second = true; });
  await tick();
  assert.equal(first, true, "the superseded wait is released so no run hangs");
  assert.equal(second, false);
  gate.release();
  await waiting;
  assert.equal(second, true);
});

test("jobs queued behind an active run are dropped once the queue is no longer live", async () => {
  const runner = oneShotRunner();
  let live = true;
  const run = createRunQueue(runner.execute, { isLive: () => live });
  const first = run("a");
  const second = run("b");
  await tick();
  live = false;
  const late = run("c");
  runner.gate.release();
  await Promise.all([first, second, late]);
  assert.deepEqual(runner.log, ["start a", "end a"]);
});

test("a job queued after unmount never starts", async () => {
  const seen: string[] = [];
  const run = createRunQueue(async (job: string) => { seen.push(job); }, { isLive: () => false });
  await run("a");
  assert.deepEqual(seen, []);
});

test("a request that never answers is rejected when its deadline passes, and the queue moves on", async () => {
  const deadline = new AbortController();
  const outcomes: string[] = [];
  const run = createRunQueue(async (job: string) => {
    if (job === "hung") {
      await withDeadline(() => new Promise<never>(() => {}), 10_000, () => deadline.signal).catch((e: unknown) => outcomes.push(`hung ${(e as Error).message}`));
      return;
    }
    outcomes.push(job);
  });
  const hung = run("hung");
  const next = run("next");
  await tick();
  assert.deepEqual(outcomes, []);
  deadline.abort(new Error("timed out"));
  await Promise.all([hung, next]);
  assert.deepEqual(outcomes, ["hung timed out", "next"]);
});

test("a request that answers before its deadline resolves with its value", async () => {
  const deadline = new AbortController();
  assert.equal(await withDeadline(() => Promise.resolve("ok"), 10_000, () => deadline.signal), "ok");
  deadline.abort(new Error("late"));
});

test("a request that fails before its deadline rejects with its own error", async () => {
  const deadline = new AbortController();
  await assert.rejects(withDeadline(() => Promise.reject(new Error("refused")), 10_000, () => deadline.signal), /refused/);
});

test("a deadline that has already passed rejects at once", async () => {
  const expired = new AbortController();
  expired.abort(new Error("already late"));
  await assert.rejects(withDeadline(() => new Promise<never>(() => {}), 10_000, () => expired.signal), /already late/);
});

test("the request gets the deadline's signal so it can cancel the network call", async () => {
  const deadline = new AbortController();
  let received: AbortSignal | undefined;
  await withDeadline((signal) => { received = signal; return Promise.resolve(); }, 10_000, () => deadline.signal);
  assert.equal(received, deadline.signal);
});
