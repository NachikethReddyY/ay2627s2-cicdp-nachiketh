import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunGate, createRunQueue } from "./runQueue.ts";

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
