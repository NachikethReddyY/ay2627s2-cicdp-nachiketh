import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePractice, PracticeContent } from "../src/parts/practice-schema.ts";

const t = (over: Record<string, unknown> = {}) => ({ id: "t1", name: "Adds", expectedStdout: "3", visibility: "sample", ...over });
const base = { kind: "practice", instructions: "Add.", language: "python", starterCode: "" };

test("a legacy expectedOutput is read as one required hidden test with id legacy", () => {
  const p = parsePractice({ kind: "practice", instructions: "Print 42.", starterCode: "", expectedOutput: "42" });
  assert.equal(p?.language, "javascript", "language defaults to javascript");
  assert.deepEqual(p?.tests, [{ id: "legacy", name: "Expected output", stdin: "", expectedStdout: "42", visibility: "hidden", stretch: false }]);
});

test("multi-test content keeps its tests and defaults stdin and stretch", () => {
  const p = parsePractice({ ...base, tests: [t(), t({ id: "bonus", visibility: "hidden", stretch: true, stdin: "1 2" })] });
  assert.equal(p?.tests.length, 2);
  assert.deepEqual([p!.tests[0]!.stdin, p!.tests[0]!.stretch], ["", false]);
  assert.deepEqual([p!.tests[1]!.stdin, p!.tests[1]!.stretch], ["1 2", true]);
});

test("tests win over a leftover expectedOutput", () => {
  const p = parsePractice({ ...base, tests: [t()], expectedOutput: "ignored" });
  assert.deepEqual(p?.tests.map((x) => x.id), ["t1"]);
});

test("typescript is a valid language", () => {
  assert.equal(parsePractice({ ...base, language: "typescript", tests: [t()] })?.language, "typescript");
});

test("invalid content is rejected", () => {
  const bad: Array<[string, unknown]> = [
    ["no tests and no expectedOutput", base],
    ["empty tests", { ...base, tests: [] }],
    ["26 tests", { ...base, tests: Array.from({ length: 26 }, (_, i) => t({ id: `t${i}` })) }],
    ["duplicate ids", { ...base, tests: [t(), t()] }],
    ["only stretch tests", { ...base, tests: [t({ stretch: true })] }],
    ["bad id", { ...base, tests: [t({ id: "Bad Id" })] }],
    ["id too long", { ...base, tests: [t({ id: "a".repeat(33) })] }],
    ["bad visibility", { ...base, tests: [t({ visibility: "secret" })] }],
    ["stdin too long", { ...base, tests: [t({ stdin: "x".repeat(1001) })] }],
    ["expectedStdout too long", { ...base, tests: [t({ expectedStdout: "x".repeat(1001) })] }],
    ["empty name", { ...base, tests: [t({ name: "" })] }],
    ["unknown language", { ...base, language: "ruby", tests: [t()] }],
    ["empty instructions", { ...base, instructions: "", tests: [t()] }],
    ["starter code too long", { ...base, starterCode: "x".repeat(3001), tests: [t()] }],
  ];
  for (const [name, content] of bad) {
    assert.equal(PracticeContent.safeParse(content).success, false, name);
    assert.equal(parsePractice(content), null, name);
  }
});

test("25 tests with one required are fine", () => {
  const tests = Array.from({ length: 25 }, (_, i) => t({ id: `t${i}`, stretch: i > 0 }));
  assert.equal(parsePractice({ ...base, tests })?.tests.length, 25);
});
