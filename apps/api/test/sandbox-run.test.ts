// No database: this file only needs the env.ts variables below.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

const { startRun, runStatus, sendRunInput, stopRun } = await import("../src/sandbox/run.ts");
const tick = () => new Promise((r) => setImmediate(r));

// A fake `docker` process. `onInput` decides what it prints and when it exits when a line arrives on stdin.
function fakeDocker(onInput: (child: FakeChild, line: string) => void, initial = "", exitAtStart: number | null = null) {
  const calls = { args: [] as string[], stdin: "" };
  const spawn = (_cmd: string, args: string[]) => {
    calls.args = args;
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new Writable({ write(chunk, _enc, done) { calls.stdin += chunk.toString(); onInput(child, chunk.toString()); done(); } });
    child.kill = () => { child.emit("close", 137); };
    setImmediate(() => {
      if (initial) child.stdout.emit("data", Buffer.from(initial));
      if (exitAtStart !== null) child.emit("close", exitAtStart);
    });
    return child as never;
  };
  return { spawn, calls };
}
type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: Writable; kill(sig?: string): void };

test("runs the code in an isolated container with no network", async () => {
  const { spawn, calls } = fakeDocker(() => {}, "", 0);
  const id = startRun("print('Points:', 17)", "learner-a", "python", spawn as never);
  assert.ok(id);
  for (const flag of ["--network", "--read-only", "--cap-drop", "--user"]) assert.ok(calls.args.includes(flag), flag);
  assert.equal(calls.args[calls.args.indexOf("--network") + 1], "none");
  assert.ok(calls.args.includes("python3") && calls.args.includes("-I") && calls.args.includes("-u"), "isolated and unbuffered");
  assert.equal(calls.args.at(-1), "print('Points:', 17)", "code is an argument, so stdin stays free");
  await tick();
  assert.equal(runStatus(id!, "learner-a", 0)?.done, true);
});

test("a JavaScript run uses node -e in the same container", async () => {
  const { spawn, calls } = fakeDocker(() => {}, "", 0);
  const id = startRun("console.log(2 + 2)", "learner-g", "javascript", spawn as never);
  assert.ok(id);
  assert.equal(calls.args[calls.args.indexOf("--network") + 1], "none");
  const i = calls.args.indexOf("node");
  assert.ok(i > 0 && calls.args[i + 1] === "-e", "node -e");
  assert.equal(calls.args.at(-1), "console.log(2 + 2)", "code is the last argument");
  await tick();
  assert.equal(runStatus(id!, "learner-g", 0)?.done, true);
});

test("a learner's answer reaches the program, and the output streams in order", async () => {
  const { spawn, calls } = fakeDocker((child, line) => {
    child.stdout.emit("data", Buffer.from("Next year: 9\n"));
    child.emit("close", 0);
    assert.equal(line, "8\n");
  }, "Age? ");
  const id = startRun("print(int(input()) + 1)", "learner-b", "python", spawn as never)!;
  await tick();
  assert.deepEqual(runStatus(id, "learner-b", 0), { output: "Age? ", next: 5, done: false, error: undefined });
  assert.equal(sendRunInput(id, "learner-b", "8"), true);
  await tick();
  assert.equal(calls.stdin, "8\n");
  assert.deepEqual(runStatus(id, "learner-b", 5), { output: "Next year: 9\n", next: 18, done: true, error: undefined });
});

test("another learner cannot read or answer a run", async () => {
  const { spawn } = fakeDocker(() => {}, "secret");
  const id = startRun("input()", "learner-c", "python", spawn as never)!;
  assert.equal(runStatus(id, "learner-d", 0), null);
  assert.equal(sendRunInput(id, "learner-d", "x"), false);
  assert.equal(stopRun(id, "learner-d"), false);
});

test("a program error is returned with its message", async () => {
  const { spawn } = fakeDocker(() => {}, "", 1);
  const id = startRun("print(1/0)", "learner-e", "python", spawn as never)!;
  await tick();
  assert.equal(runStatus(id, "learner-e", 0)?.error, "The code stopped with an error.");
});

test("a learner can have only a few live runs", () => {
  const { spawn } = fakeDocker(() => {});
  assert.ok(startRun("input()", "learner-f", "python", spawn as never));
  assert.ok(startRun("input()", "learner-f", "python", spawn as never));
  assert.equal(startRun("input()", "learner-f", "python", spawn as never), null);
});
