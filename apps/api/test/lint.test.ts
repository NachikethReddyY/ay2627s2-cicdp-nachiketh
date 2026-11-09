import { signUp } from "./helpers.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { env } from "../src/env.ts";
import { lintCode, LintUnavailableError, MAX_PENDING, sourceLineOf } from "../src/lint/index.ts";

const app = buildApp();
after(() => app.close());

test("lintCode: clean JavaScript returns no findings", async () => {
  assert.deepEqual(await lintCode("const x = 1;\nconsole.log(x);\n", "javascript"), []);
});

test("lintCode: node globals are not undefined", async () => {
  assert.deepEqual(await lintCode("const fs = require('fs');\nconsole.log(fs, __dirname, process.argv);\n", "javascript"), []);
});

test("lintCode: var is reported as no-var on line 1", async () => {
  const f = await lintCode("var x = 1;\nconsole.log(x);\n", "javascript");
  const v = f.find((x) => x.ruleId === "no-var");
  assert.ok(v);
  assert.equal(v.line, 1);
  assert.equal(v.column, 1);
  assert.deepEqual(Object.keys(v).sort(), ["column", "line", "message", "ruleId"]);
});

test("lintCode: JavaScript bugs are reported", async () => {
  const f = await lintCode("let a = 1;\nif (a == 2) {}\nconsole.log(missing);\n", "javascript");
  const ids = f.map((x) => x.ruleId);
  for (const id of ["prefer-const", "eqeqeq", "no-empty", "no-undef"]) assert.ok(ids.includes(id), id);
});

test("lintCode: a JavaScript syntax error is a finding, not an empty result", async () => {
  const f = await lintCode("const = ;", "javascript");
  assert.equal(f.length, 1);
  assert.equal(f[0]!.ruleId, "syntax-error");
});

test("lintCode: TypeScript unused variable is reported, types are not flagged", async () => {
  const f = await lintCode("type Id = number;\nconst id: Id = 1;\nconst unused: number = 2;\nconsole.log(id);\n", "typescript");
  assert.deepEqual(f.map((x) => [x.ruleId, x.line]), [["@typescript-eslint/no-unused-vars", 3]]);
});

test("lintCode: clean TypeScript returns no findings", async () => {
  assert.deepEqual(await lintCode("interface P { n: string }\nconst p: P = { n: 'a' };\nconsole.log(p.n);\n", "typescript"), []);
});

test("lintCode: Python unused import is F401 on line 1", async () => {
  const f = await lintCode("import os\n", "python");
  assert.equal(f.length, 1);
  assert.equal(f[0]!.ruleId, "F401");
  assert.equal(f[0]!.line, 1);
  assert.deepEqual(Object.keys(f[0]!).sort(), ["column", "line", "message", "ruleId"]);
});

test("lintCode: clean Python returns no findings; a syntax error is a finding", async () => {
  assert.deepEqual(await lintCode("print('hi')\n", "python"), []);
  const f = await lintCode("def (:\n", "python");
  assert.ok(f.length > 0);
  assert.equal(f[0]!.ruleId, "invalid-syntax");
});

test("lintCode: exceeding the timeout rejects with LintUnavailableError, and the next call still works", async () => {
  const huge = `const a = [${"1,".repeat(2_000_000)}];\n`;
  await assert.rejects(lintCode(huge, "javascript", { timeoutMs: 1 }), LintUnavailableError);
  assert.deepEqual(await lintCode("const x = 1;\nconsole.log(x);\n", "javascript"), []);
});

test("lintCode: a full queue rejects fast with LintUnavailableError and nothing hangs", async () => {
  const slow = `const a = [${"1,".repeat(2_000_000)}];\n`;
  const started = Date.now();
  const results = await Promise.allSettled(Array.from({ length: MAX_PENDING + 4 }, () => lintCode(slow, "javascript", { timeoutMs: 300 })));
  assert.ok(results.every((r) => r.status === "rejected" && r.reason instanceof LintUnavailableError || r.status === "fulfilled"));
  assert.ok(results.filter((r) => r.status === "rejected").length >= 4);
  assert.ok(Date.now() - started < 10_000);
  assert.deepEqual(await lintCode("const x = 1;\nconsole.log(x);\n", "javascript"), []);
});

test("lintCode: inline eslint directives are ignored", async () => {
  const a = await lintCode("const a = 1; // eslint-disable-line no-var\nconsole.log(a);\n", "javascript");
  assert.equal(a.some((f) => f.ruleId === "syntax-error"), false);
  const b = await lintCode("var a = 1; /* eslint-disable */\nconsole.log(a);\n", "javascript");
  assert.ok(b.some((f) => f.ruleId === "no-var"));
});

test("sourceLineOf: counts CR, CRLF, LF, U+2028 and U+2029 as line breaks like ESLint", async () => {
  const code = "x = 1\r\ny=2\u2028var z=3";
  const f = (await lintCode(code, "javascript")).find((x) => x.ruleId === "no-var");
  assert.ok(f);
  assert.equal(sourceLineOf(code, f.line), "var z=3");
  assert.equal(sourceLineOf("a\rb\u2029c", 3), "c");
});

const post = (cookie: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/practice/lint", headers: { cookie, origin: env.PUBLIC_ORIGIN }, payload });

test("POST /practice/lint: 401 signed out", async () => {
  const res = await post("", { code: "var x = 1;", language: "javascript" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, "unauthorized");
});

test("POST /practice/lint: findings, 400 for a bad body and for code over 20000 characters", async () => {
  const cookie = await signUp(app);
  const ok = await post(cookie, { code: "var x = 1;\nconsole.log(x);\n", language: "javascript" });
  assert.equal(ok.statusCode, 200);
  assert.ok((ok.json().findings as { ruleId: string }[]).some((f) => f.ruleId === "no-var"));
  const long = await post(cookie, { code: "a".repeat(20_001), language: "javascript" });
  assert.equal(long.statusCode, 400);
  assert.equal(long.json().error.code, "bad_request");
  assert.equal((await post(cookie, { code: "x", language: "ruby" })).statusCode, 400);
});

test("POST /practice/lint: 429 after 30 requests in a minute", async () => {
  const cookie = await signUp(app, "rate@example.com");
  for (let i = 0; i < 30; i++) assert.equal((await post(cookie, { code: "", language: "python" })).statusCode, 200);
  const res = await post(cookie, { code: "", language: "python" });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error.code, "rate_limited");
});
