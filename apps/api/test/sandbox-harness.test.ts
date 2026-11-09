// No database: this file only needs the env.ts variables below.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const { HARNESS_SOURCE, MAX_STDOUT, MAX_STDERR, TEST_TIMEOUT_MS } = await import("../src/sandbox/checkHarness.ts");
const { classify, score, runInContainer, CheckUnavailableError } = await import("../src/sandbox/check.ts");

const tick = () => new Promise((r) => setImmediate(r));

type Script = { stdout?: string; stderr?: string; exit?: number; hang?: boolean };
type Spawned = { cmd: string; args: string[]; cwd: string; stdin: string };

// Runs the real harness source against a fake `spawn` that plays one script per test.
function harness(scripts: Script[], input: object) {
  (globalThis as Record<string, unknown>).__LQ_HARNESS_TEST__ = true;
  const runHarness = new Function("process", "require", `${HARNESS_SOURCE}\nreturn runHarness;`)(process, createRequire(import.meta.url));
  const spawned: Spawned[] = [];
  const written: Record<string, string> = {};
  let output = "";
  const spawn = (cmd: string, args: string[], opts: { cwd: string }) => {
    const script = scripts[spawned.length]!;
    const rec: Spawned = { cmd, args, cwd: opts.cwd, stdin: "" };
    spawned.push(rec);
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end: (s: string) => { rec.stdin = s; } });
    child.kill = () => { child.emit("close", null); };
    setImmediate(() => {
      if (script.hang) return;
      if (script.stdout) (child.stdout as EventEmitter).emit("data", Buffer.from(script.stdout));
      if (script.stderr) (child.stderr as EventEmitter).emit("data", Buffer.from(script.stderr));
      child.emit("close", script.exit ?? 0);
    });
    return child;
  };
  const done = runHarness({
    spawn,
    readStdin: async () => JSON.stringify(input),
    mkdir: () => {},
    writeFile: (p: string, c: string) => { written[p] = c; },
    write: (s: string) => { output += s; },
  });
  return { done, spawned, written, output: () => JSON.parse(output.trim()) as { results: Array<Record<string, unknown>> } };
}

test("harness writes the code, spawns the interpreter per test with its stdin, and reports one JSON line", async () => {
  const h = harness([{ stdout: "3\n" }, { stdout: "x" }], { language: "python", code: "print(1)", tests: [{ stdin: "1 2" }, { stdin: "" }] });
  await h.done;
  assert.deepEqual(h.written, { "/tmp/work/solution.py": "print(1)" });
  assert.deepEqual(h.spawned.map((s) => [s.cmd, s.args, s.stdin]), [
    ["python3", ["-I", "-u", "solution.py"], "1 2"],
    ["python3", ["-I", "-u", "solution.py"], ""],
  ]);
  assert.equal(h.spawned[0]!.cwd, "/tmp/work");
  assert.deepEqual(h.output().results[0], { exit: 0, timedOut: false, overflow: false, stdout: "3\n", stderr: "" });
});

test("harness picks node for javascript and typescript", async () => {
  for (const [language, file] of [["javascript", "solution.js"], ["typescript", "solution.ts"]] as const) {
    const h = harness([{}], { language, code: "x", tests: [{ stdin: "" }] });
    await h.done;
    assert.deepEqual([h.spawned[0]!.cmd, h.spawned[0]!.args], ["node", [file]]);
    assert.ok(`/tmp/work/${file}` in h.written);
  }
});

test("harness reports exit codes, caps stdout and stderr, and flags overflow", async () => {
  const h = harness(
    [{ exit: 1, stderr: "e".repeat(MAX_STDERR + 100) }, { stdout: "o".repeat(MAX_STDOUT + 50) }],
    { language: "javascript", code: "x", tests: [{ stdin: "" }, { stdin: "" }] },
  );
  await h.done;
  const [a, b] = h.output().results as Array<{ exit: number; stderr: string; stdout: string; overflow: boolean }>;
  assert.equal(a!.exit, 1);
  assert.equal(a!.stderr.length, MAX_STDERR);
  assert.equal(b!.stdout.length, MAX_STDOUT);
  assert.equal(b!.overflow, true);
});

test("harness kills a test that runs past the per-test timeout and goes on to the next", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const h = harness([{ hang: true }, { stdout: "ok" }], { language: "javascript", code: "while(1){}", tests: [{ stdin: "" }, { stdin: "" }] });
    await tick();
    mock.timers.tick(TEST_TIMEOUT_MS);
    await tick();
    await h.done;
    const [a, b] = h.output().results as Array<{ timedOut: boolean; stdout: string }>;
    assert.equal(a!.timedOut, true);
    assert.equal(b!.timedOut, false);
    assert.equal(b!.stdout, "ok");
  } finally {
    mock.timers.reset();
  }
});

const raw = (over: Partial<Parameters<typeof classify>[0]> = {}) => ({ exit: 0, timedOut: false, overflow: false, stdout: "", stderr: "", ...over });

test("classify: pass, fail, timeout, error and overflow", () => {
  assert.equal(classify(raw({ stdout: " 3\n" }), "3"), "pass", "trimmed match");
  assert.equal(classify(raw({ stdout: "4" }), "3"), "fail");
  assert.equal(classify(raw({ timedOut: true, exit: null }), "3"), "timeout");
  assert.equal(classify(raw({ exit: 1, stdout: "3" }), "3"), "error", "non-zero exit is an error even when the output matches");
  assert.equal(classify(raw({ exit: null }), "3"), "error", "killed by something other than the timeout");
  assert.equal(classify(raw({ stdout: "3", overflow: true }), "3"), "fail", "output not seen in full is never a pass");
});

const tests = [
  { id: "a", name: "A", stdin: "1", expectedStdout: "1", visibility: "sample" as const, stretch: false },
  { id: "b", name: "B", stdin: "secret-in", expectedStdout: "secret-out", visibility: "hidden" as const, stretch: false },
  { id: "c", name: "C", stdin: "", expectedStdout: "ok", visibility: "hidden" as const, stretch: true },
  { id: "d", name: "D", stdin: "", expectedStdout: "ok", visibility: "sample" as const, stretch: true },
];

test("score: required and stretch counts, points, completion, and what each kind of test may reveal", () => {
  const s = score(tests, [raw({ stdout: "1" }), raw({ stdout: "wrong secret-out?" }), raw({ stdout: "ok" }), raw({ exit: 1, stderr: "boom" })]);
  assert.deepEqual(s.required, { passed: 1, total: 2 });
  assert.deepEqual(s.stretch, { passed: 1, total: 2 });
  assert.equal(s.points, 2);
  assert.equal(s.maxPoints, 4);
  assert.equal(s.complete, false);
  assert.deepEqual(s.results[0], { id: "a", name: "A", stretch: false, visibility: "sample", status: "pass", stdin: "1", expectedStdout: "1", actualStdout: "1" });
  assert.deepEqual(s.results[1], { id: "b", name: "B", stretch: false, visibility: "hidden", status: "fail" }, "hidden: no stdin, expected or actual output");
  assert.deepEqual(s.results[2], { id: "c", name: "C", stretch: true, visibility: "hidden", status: "pass" });
  assert.equal(s.results[3]!.error, "boom");
  assert.ok(!JSON.stringify(s.results[1]).includes("secret"));
});

test("score: complete once every required test passes, whatever the stretch tests do", () => {
  const s = score(tests, [raw({ stdout: "1" }), raw({ stdout: "secret-out" }), raw({ stdout: "nope" }), raw({ timedOut: true, exit: null })]);
  assert.equal(s.complete, true);
  assert.equal(s.points, 2);
  assert.match(s.results[3]!.error!, /Timed out/);
});

// A fake `docker run` printing `stdout`, for the host's handling of harness output.
function fakeDocker(stdout: string) {
  return (() => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end() {} });
    child.kill = () => {};
    setImmediate(() => { (child.stdout as EventEmitter).emit("data", Buffer.from(stdout)); child.emit("close", 0); });
    return child;
  }) as never;
}

test("runInContainer: missing, malformed or short harness output is an error, never a pass", async () => {
  const one = [tests[0]!];
  for (const out of ["", "not json\n", '{"results":[]}\n', '{"results":[{"exit":0}]}\n', '{"results":[{"exit":0,"timedOut":false,"overflow":false,"stdout":"1"},{}]}\n']) {
    await assert.rejects(runInContainer("x", "python", one, fakeDocker(out)), CheckUnavailableError, JSON.stringify(out));
  }
  const ok = await runInContainer("x", "python", one, fakeDocker('{"results":[{"exit":0,"timedOut":false,"overflow":false,"stdout":"1","stderr":""}]}\n'));
  assert.equal(ok[0]!.stdout, "1");
});

test("runInContainer: one hardened container with the code and tests on stdin", async () => {
  let args: string[] = [];
  let stdin = "";
  const spawn = ((_c: string, a: string[]) => {
    if (a[0] === "run") args = a;
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end(s: string) { stdin = s; } });
    child.kill = () => {};
    setImmediate(() => { (child.stdout as EventEmitter).emit("data", Buffer.from('{"results":[{"exit":0,"timedOut":false,"overflow":false,"stdout":"","stderr":""}]}')); child.emit("close", 0); });
    return child;
  }) as never;
  await runInContainer("print(1)", "python", [tests[0]!], spawn);
  for (const flag of ["--network", "--read-only", "--cap-drop", "--user", "--cpus", "--memory", "--pids-limit", "--security-opt", "--tmpfs"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.deepEqual(args.slice(args.indexOf("node")).slice(0, 2), ["node", "-e"]);
  assert.equal(args.filter((a) => a === "run").length, 1, "one container per check");
  assert.deepEqual(JSON.parse(stdin), { language: "python", code: "print(1)", tests: [{ stdin: "1" }] });
});
