// Runs the real harness in the real sandbox image. Skipped when Docker or the image is not available.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://x:x@localhost:5432/x_test";
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-not-for-production-0123456789";

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const { env } = await import("../src/env.ts");
const { runInContainer, score } = await import("../src/sandbox/check.ts");
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
