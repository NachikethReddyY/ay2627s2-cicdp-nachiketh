import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { containsAnswer } from "../src/ai/answer-leak.ts";
import { McqStep } from "../src/ai/step-schema.ts";
import { gradeCloze } from "../src/grading/cloze.ts";

type LeakVector = { name: string; text: string; answer: string; leaks: boolean };

const leakVectors: LeakVector[] = JSON.parse(
  readFileSync(new URL("../../../services/engine/tests/fixtures/leak_vectors.json", import.meta.url), "utf8"),
);
const step = {
  kind: "mcq",
  title: "Hand back the sum",
  prompt: "What should the function give the caller?",
  beforeFiles: { "src/add.js": "export function add(a, b) {\n  console.log(a + b);\n}\n" },
  hunks: [{ id: "h1", file: "src/add.js", oldStart: 1, lines: [" export function add(a, b) {", "-  console.log(a + b);", "+  return a + b;", " }"] }],
  hints: [{ text: "Use a return statement." }],
  explanations: { workedExample: "The body can send a value back.", practice: "Write a multiply function next." },
  options: ["return a + b", "return a - b", "return a * b", "return a / b"],
  answer: 0,
  concepts: ["variables"],
};

test("an mcq option in starter code is not a leak", () => {
  const mcq = {
    ...step,
    beforeFiles: { "src/add.js": `// return a + b is what add should do\n${step.beforeFiles["src/add.js"]}` },
  };
  assert.equal(McqStep.safeParse(mcq).success, true);
});

test("MCQ options use literal matching for code-like options", () => {
  for (const answer of ["a // b", "x /* y", "a // b"]) {
    const mcq = {
      ...step,
      options: [answer, "other one", "other two", "other three"],
      answer: 0,
      prompt: "The values a and b appear in this expression.",
    };
    assert.equal(McqStep.safeParse(mcq).success, true);
  }
  const exact = {
    ...step,
    options: ["a // b", "other one", "other two", "other three"],
    answer: 0,
    prompt: "Enter a // b.",
  };
  assert.equal(McqStep.safeParse(exact).success, false);
  const short = { ...exact, options: ["c", "other one", "other two", "other three"], prompt: "What changes?" };
  assert.equal(McqStep.safeParse(short).success, true);
});

test("anything the grader accepts as the answer is flagged by the leak check", () => {
  const answers = [
    ["discount", "=", "0"],
    ["return", "a", "+", "b"],
    ["-", "1"],
    ["x", "=", '"a  b"'],
    ["if", "(", "ok", ")"],
    ["const", "n", "=", "'it\\'s'"],
    ["a", "$b", "_c", "0.5", "1e3"],
    ["\u0085", "x"],
    ["`t ${x}`", "y"],
  ];
  const separators = [" ", "\t", "\n", "\u00a0 ", "\u3000", " /*x*/ ", " //x\n", "\u2028", "\ufeff", "\v\f"];
  const wrappers = [(s: string) => s, (s: string) => `Type ${s} now.`, (s: string) => `/*a*/${s}//b`];
  for (const tokens of answers) {
    for (const [a, b] of separators.flatMap((x) => separators.map((y) => [x, y]))) {
      const canonical = tokens.join(a);
      const submission = tokens.join(b);
      assert.equal(gradeCloze(submission, canonical, []), true, JSON.stringify({ canonical, submission }));
      for (const wrap of wrappers) {
        assert.equal(containsAnswer(wrap(submission), canonical), true, JSON.stringify({ canonical, text: wrap(submission) }));
      }
    }
  }
});

test("whitespace is exactly what the grader skips, code unit by code unit", () => {
  for (let unit = 0; unit <= 0xffff; unit++) {
    const char = String.fromCharCode(unit);
    const text = `a${char}b`;
    assert.equal(containsAnswer(text, "a b"), gradeCloze(text, "a b", []), `U+${unit.toString(16).padStart(4, "0")}`);
  }
});

for (const vector of leakVectors) {
  test(`leak vector: ${vector.name}`, () => {
    assert.equal(containsAnswer(vector.text, vector.answer), vector.leaks);
  });
}
