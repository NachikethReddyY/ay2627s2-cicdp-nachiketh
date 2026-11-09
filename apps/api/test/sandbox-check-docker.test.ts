// Runs the real harness in the real sandbox image. Skipped when Docker or the image is not available.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const { env } = await import("../src/env.ts");
const { runInContainer, score, CheckUnavailableError } =await import("../src/sandbox/check.ts");
type T = Parameters<typeof score>[0][number];

const hasImage = spawnSync("docker", ["image", "inspect", env.SANDBOX_IMAGE], { stdio: "ignore" }).status === 0;
const skip = !hasImage && `docker or image ${env.SANDBOX_IMAGE} not available`;

const mk = (id: string, expectedStdout: string, over: Partial<T> = {}): T => ({ id, name: id, stdin: "", expectedStdout, visibility: "sample", stretch: false, ...over });

test("javascript: pass, fail, error and a timeout in one container", { skip, timeout: 60_000 }, async () => {
  const code = `
const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\\n");
const mode = lines[0];
if (mode === "loop") { while (true) {} }
if (mode === "throw") throw new Error("boom");
if (mode === "wrong") console.log("nope");
else console.log(Number(lines[1]) + Number(lines[2]));
`;
  const tests = [
    mk("add", "5", { stdin: "add\n2\n3" }),
    mk("wrong", "5", { stdin: "wrong", visibility: "hidden" }),
    mk("throws", "x", { stdin: "throw", stretch: true }),
    mk("loops", "x", { stdin: "loop", stretch: true }),
  ];
  const s = score(tests, await runInContainer(code, "javascript", tests));
  assert.deepEqual(s.results.map((r) => r.status), ["pass", "fail", "error", "timeout"]);
  assert.match(s.results[2]!.error!, /boom/);
  assert.equal(s.points, 1);
  assert.equal(s.complete, false);
});

test("python: reads stdin per test and passes", { skip, timeout: 60_000 }, async () => {
  const code = "n = int(input())\nprint(n * 2)\n";
  const tests = [mk("one", "4", { stdin: "2" }), mk("two", "20", { stdin: "10", visibility: "hidden" })];
  const s = score(tests, await runInContainer(code, "python", tests));
  assert.deepEqual(s.results.map((r) => r.status), ["pass", "pass"]);
  assert.equal(s.complete, true);
  assert.deepEqual(s.results[1], { id: "two", name: "two", stretch: false, visibility: "hidden", status: "pass" });
});

test("typescript runs through node type stripping", { skip, timeout: 60_000 }, async () => {
  const code = "const x: number = 21;\nconsole.log(x * 2);\n";
  const tests = [mk("ts", "42")];
  const s = score(tests, await runInContainer(code, "typescript", tests));
  assert.equal(s.results[0]!.status, "pass");
});

test("a program that prints too much fails instead of passing", { skip, timeout: 60_000 }, async () => {
  const code = "console.log('a'.repeat(5000))";
  const tests = [mk("big", "a".repeat(5000))];
  const s = score(tests.map((t) => ({ ...t, expectedStdout: t.expectedStdout.slice(0, 1000) })), await runInContainer(code, "javascript", tests));
  assert.equal(s.results[0]!.status, "fail");
});

// Privilege separation: the harness is root, the learner is uid 1001, so the learner cannot reach the harness through /proc.
const dockerUp = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
const skipPriv = (!dockerUp && "docker is not running") || skip;
const isPass = (s: ReturnType<typeof score>) => s.results[0]!.status === "pass";

test("a learner that forges a pass line on the harness stdout and kills the harness does not pass", { skip: skipPriv, timeout: 60_000 }, async () => {
  const forged = JSON.stringify({ token: "guess", results: [{ exit: 0, timedOut: false, overflow: false, stdout: "42", stderr: "" }] });
  const code = `
const fs = require("node:fs");
const ppid = process.ppid;
console.log("wrong");
try { fs.writeFileSync("/proc/" + ppid + "/fd/1", ${JSON.stringify(forged)} + "\\n"); } catch (e) { console.error("write " + e.code); }
try { process.kill(ppid, "SIGKILL"); } catch (e) { console.error("kill " + e.code); }
`;
  const tests = [mk("t", "42")];
  let passed = false;
  try {
    passed = isPass(score(tests, await runInContainer(code, "javascript", tests)));
  } catch (e) {
    assert.ok(e instanceof CheckUnavailableError, "a harness failure, not another error");
  }
  assert.equal(passed, false);
});

test("a learner cannot open the harness's /proc fd directory or memory", { skip: skipPriv, timeout: 60_000 }, async () => {
  const code = `
const fs = require("node:fs");
const p = "/proc/" + process.ppid;
const tryIt = (f) => { try { f(); return "OPENED"; } catch (e) { return e.code; } };
const r = [
  tryIt(() => fs.readdirSync(p + "/fd")),
  tryIt(() => fs.openSync(p + "/mem", "r")),
  tryIt(() => fs.readFileSync(p + "/environ")),
];
console.log(r.join(","));
`;
  const tests = [mk("t", "EACCES,EACCES,EACCES")];
  const s = score(tests, await runInContainer(code, "javascript", tests));
  assert.equal(s.results[0]!.actualStdout?.trim(), "EACCES,EACCES,EACCES");
  assert.equal(isPass(s), true);
});

test("the learner runs as uid 1001 with no capabilities, and a normal solution still passes", { skip: skipPriv, timeout: 60_000 }, async () => {
  const code = `
const fs = require("node:fs");
const caps = fs.readFileSync("/proc/self/status", "utf8").match(/CapEff:\\s*(\\w+)/)[1];
const n = Number(fs.readFileSync(0, "utf8").trim());
console.log(process.getuid(), process.getgid(), caps, n * 2);
`;
  const tests = [mk("t", "1001 1001 0000000000000000 8", { stdin: "4" })];
  const s = score(tests, await runInContainer(code, "javascript", tests));
  assert.equal(s.results[0]!.actualStdout?.trim(), "1001 1001 0000000000000000 8");
  assert.equal(s.complete, true);
});
