// No database: this file only needs the env.ts variables below.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

const { startRun, runStatus, sendRunInput, stopRun, setRmTimeoutForTests } = await import("../src/sandbox/run.ts");
const tick = () => new Promise((r) => setImmediate(r));

// A fake `docker` process. `onInput` decides what it prints and when it exits when a line arrives on stdin.
function fakeDocker(onInput: (child: FakeChild, line: string) => void, initial = "", exitAtStart: number | null = null) {
  // `args` is the `docker run` call; `rm` is the `docker rm -f` call, whose exit the test controls through `rmChild`.
  const calls = { args: [] as string[], rm: [] as string[], rmChild: null as FakeChild | null, stdin: "" };
  const spawn = (_cmd: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild;
    if (args[0] === "rm") {
      calls.rm = args;
      calls.rmChild = child;
    } else calls.args = args;
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

test("stopping a run removes its container by name, and frees the slot only after docker rm exits", async () => {
  const { spawn, calls } = fakeDocker(() => {});
  const id = startRun("input()", "learner-h", "python", spawn as never)!;
  assert.equal(calls.args[calls.args.indexOf("--name") + 1], `lq-run-${id}`, "container has a known name");
  assert.ok(startRun("input()", "learner-h", "python", spawn as never), "second run");
  await tick();

  assert.equal(stopRun(id, "learner-h"), true);
  assert.deepEqual(calls.rm, ["rm", "-f", `lq-run-${id}`]);
  assert.equal(runStatus(id, "learner-h", 0)?.done, false, "slot held while docker rm runs");
  assert.equal(startRun("input()", "learner-h", "python", spawn as never), null, "still at the limit");

  calls.rmChild!.emit("close", 0);
  await tick();
  assert.equal(runStatus(id, "learner-h", 0)?.done, true);
  assert.ok(startRun("input()", "learner-h", "python", spawn as never), "slot freed after rm");
});

test("a docker rm that never closes is killed and frees the slot after the timeout", async () => {
  setRmTimeoutForTests(200);
  try {
    const { spawn, calls } = fakeDocker(() => {});
    const id = startRun("input()", "learner-rm", "python", spawn as never)!;
    stopRun(id, "learner-rm");
    assert.equal(runStatus(id, "learner-rm", 0)?.done, false, "held while rm hangs");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(runStatus(id, "learner-rm", 0)?.done, true, "freed after the timeout");
    assert.ok(calls.rmChild);
  } finally {
    setRmTimeoutForTests(10_000);
  }
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

// A Check run: `saved` counts recorded completions; `fail` makes saving throw.
function fakeCheck(expected: string, fail = false) {
  const check = { expected, saved: 0, record: async () => { if (fail) throw new Error("db down"); check.saved++; } };
  return check;
}

test("a checked run that prints the expected output is recorded and passes", async () => {
  const { spawn } = fakeDocker(() => {}, "Points: 17\n", 0);
  const check = fakeCheck("Points: 17");
  const id = startRun("print('Points:', 17)", "learner-k1", "python", spawn as never, check)!;
  await tick();
  await tick();
  assert.equal(check.saved, 1);
  assert.deepEqual(runStatus(id, "learner-k1", 0), { output: "Points: 17\n", next: 11, done: true, error: undefined, passed: true });
});

test("a checked run reports done only after its completion is saved", async () => {
  const { spawn } = fakeDocker(() => {}, "1", 0);
  let release!: () => void;
  const check = { expected: "1", record: () => new Promise<void>((r) => { release = r; }) };
  const id = startRun("print(1)", "learner-k2", "python", spawn as never, check)!;
  await tick();
  assert.equal(runStatus(id, "learner-k2", 0)?.done, false, "still saving");
  assert.equal(runStatus(id, "learner-k2", 0)?.passed, undefined, "no verdict yet");
  release();
  await tick();
  assert.equal(runStatus(id, "learner-k2", 0)?.passed, true);
});

test("a checked run with the wrong output, an error, or a stop records nothing", async () => {
  const wrong = fakeCheck("2");
  const a = startRun("print(1)", "learner-k3", "python", fakeDocker(() => {}, "1\n", 0).spawn as never, wrong)!;
  const crashed = fakeCheck("");
  const b = startRun("print(1/0)", "learner-k3", "python", fakeDocker(() => {}, "", 1).spawn as never, crashed)!;
  await tick();
  await tick();
  assert.equal(runStatus(a, "learner-k3", 0)?.passed, false);
  assert.equal(runStatus(b, "learner-k3", 0)?.passed, false);

  const stopped = fakeCheck("");
  const { spawn, calls } = fakeDocker(() => {});
  const c = startRun("input()", "learner-k4", "python", spawn as never, stopped)!;
  await tick();
  stopRun(c, "learner-k4");
  calls.rmChild!.emit("close", 0);
  await tick();
  assert.equal(runStatus(c, "learner-k4", 0)?.passed, false);
  assert.equal(wrong.saved + crashed.saved + stopped.saved, 0);
});

test("a checked run whose result cannot be saved fails with a message", async () => {
  const { spawn } = fakeDocker(() => {}, "1", 0);
  const id = startRun("print(1)", "learner-k5", "python", spawn as never, fakeCheck("1", true))!;
  await tick();
  await tick();
  const s = runStatus(id, "learner-k5", 0)!;
  assert.equal(s.passed, false);
  assert.match(s.error ?? "", /Could not save/);
});

test("a plain run carries no verdict", async () => {
  const { spawn } = fakeDocker(() => {}, "1", 0);
  const id = startRun("print(1)", "learner-k6", "python", spawn as never)!;
  await tick();
  assert.equal("passed" in runStatus(id, "learner-k6", 0)!, false);
});

test("a checked run whose output overflowed the buffer fails, even if the kept part matches", async () => {
  const kept = "x".repeat(8000);
  const { spawn } = fakeDocker((child) => {
    child.stdout.emit("data", Buffer.from("extra output the buffer dropped"));
    child.emit("close", 0);
  }, kept);
  const check = fakeCheck(kept);
  const id = startRun("print('x' * 8000); input(); print('extra')", "learner-k7", "python", spawn as never, check)!;
  await tick();
  sendRunInput(id, "learner-k7", "go");
  await tick();
  await tick();
  assert.equal(runStatus(id, "learner-k7", 0)?.passed, false);
  assert.equal(check.saved, 0);
});

test("stopping a run while its completion is saving does not change its verdict", async () => {
  const { spawn, calls } = fakeDocker(() => {}, "1", 0);
  let release!: () => void;
  const check = { expected: "1", record: () => new Promise<void>((r) => { release = r; }) };
  const id = startRun("print(1)", "learner-k8", "python", spawn as never, check)!;
  await tick();
  assert.equal(stopRun(id, "learner-k8"), true);
  assert.deepEqual(calls.rm, [], "the program already exited, so there is no container to remove");
  release();
  await tick();
  const s = runStatus(id, "learner-k8", 0)!;
  assert.deepEqual([s.done, s.passed, s.error], [true, true, undefined]);
});
