import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { containsAnswer } from "../src/ai/answer-leak.ts";
import { checkStep, Step, type GeneratedStep } from "../src/ai/step-schema.ts";
import { gradeCloze } from "../src/grading/cloze.ts";

type LeakVector = { name: string; text: string; answer: string; leaks: boolean };

const leakVectors: LeakVector[] = JSON.parse(
  readFileSync(new URL("../../../services/engine/tests/fixtures/leak_vectors.json", import.meta.url), "utf8"),
);
const trimVectors: { name: string; input: string; expected: string | null }[] = JSON.parse(
  readFileSync(new URL("../../../services/engine/tests/fixtures/cloze_trim_vectors.json", import.meta.url), "utf8"),
);

const before = "export function add(a, b) {\n  console.log(a + b);\n}\n";

const step = {
  kind: "cloze",
  title: "Hand back the sum",
  prompt: "What should the function give the caller?",
  beforeFiles: { "src/add.js": before },
  hunks: [{ id: "h1", file: "src/add.js", oldStart: 1, lines: [" export function add(a, b) {", "-  console.log(a + b);", "+  return a + b;", " }"] }],
  hints: [{ text: "Use a return statement." }],
  explanations: { workedExample: "The body can send a value back.", practice: "Write a multiply function next." },
  answer: "return a + b",
  accepted: [],
  concepts: [],
};

test("a clean cloze step passes the schema and checks", () => {
  assert.equal(Step.safeParse(step).success, true);
  checkStep(Step.parse(step));
});

for (const vector of trimVectors) {
  test(`cloze schema trim vector: ${vector.name}`, () => {
    const parsed = Step.safeParse({ ...step, answer: vector.input, accepted: [vector.input] });
    assert.equal(parsed.success, vector.expected !== null);
    if (parsed.success && parsed.data.kind === "cloze") {
      assert.equal(parsed.data.answer, vector.expected);
      assert.deepEqual(parsed.data.accepted, [vector.expected]);
    }
  });
}

test("a cloze answer in the prompt is rejected", () => {
  const bad = { ...step, prompt: "Type the exact answer: return a + b" };
  assert.equal(Step.safeParse(bad).success, false);
  assert.throws(() => checkStep(bad as unknown as GeneratedStep), /leak/);
});

test("a cloze answer in the practice explanation is rejected", () => {
  const bad = { ...step, explanations: { ...step.explanations, practice: "Then write return a + b in your own function." } };
  assert.equal(Step.safeParse(bad).success, false);
  assert.throws(() => checkStep(bad as unknown as GeneratedStep), /leak/);
});

function assertRejected(bad: unknown) {
  assert.equal(Step.safeParse(bad).success, false);
  assert.throws(() => checkStep(bad as GeneratedStep), /leak/);
}

test("a cloze answer with other spacing in the prompt is rejected", () => {
  const spaced = { ...step, answer: "discount = 0", prompt: "Fill in the blank with `discount=0`." };
  assertRejected(spaced);
});

test("a cloze answer in a starter code comment is rejected", () => {
  assertRejected({ ...step, beforeFiles: { "src/add.js": `// Enter return a + b in the blank\n${before}` } });
});

test("case changes in starter code do not match cloze code tokens", () => {
  assert.equal(Step.safeParse({ ...step, answer: "discount = 0", beforeFiles: { "src/add.js": "DISCOUNT = 0" } }).success, true);
});

test("an mcq option in starter code is not a leak", () => {
  const mcq = {
    ...step,
    kind: "mcq",
    options: ["return a + b", "return a - b", "return a * b", "return a / b"],
    answer: 0,
    accepted: undefined,
    beforeFiles: { "src/add.js": `// return a + b is what add should do\n${before}` },
  };
  assert.equal(Step.safeParse(mcq).success, true);
});

test("a whole-word keyword in the prompt is rejected", () => {
  assertRejected({ ...step, answer: "let", prompt: "Use the let keyword to declare it." });
});

test("a keyword inside a longer word is not a leak", () => {
  const ok = { ...step, answer: "let", prompt: "Complete the declaration using the block-scoped keyword" };
  assert.equal(Step.safeParse(ok).success, true);
  checkStep(Step.parse(ok));
});

test("a comment between the answer tokens in the prompt is rejected", () => {
  assertRejected({ ...step, answer: "discount = 0", prompt: "Enter `discount /*x*/ = 0` in the blank." });
});

test("a line comment and newline between the answer tokens in the prompt is rejected", () => {
  assertRejected({ ...step, answer: "discount = 0", prompt: "Enter discount //x\n= 0 in the blank." });
});

test("a comment inside the answer does not hide it from the prompt", () => {
  assertRejected({ ...step, answer: "discount /*x*/ = 0", prompt: "Enter `discount=0` in the blank." });
});

test("a one-character-wide answer is rejected when the prompt shows it", () => {
  assertRejected({ ...step, answer: "- 1", prompt: "Type `- 1`." });
});

test("short keywords are rejected as whole tokens", () => {
  for (const [answer, prompt] of [["if", "Start with if you want to branch."], ["of", "Say of course."], ["1", "Type 1 here."], ["_", "Type _ here."]]) {
    assertRejected({ ...step, answer, prompt });
  }
});

test("a keyword inside a longer word still passes", () => {
  for (const [answer, prompt] of [["if", "Compare the diff."], ["of", "We offer a hint."], ["1", "Type 10 here."], ["_", "Type snake_case here."]]) {
    assert.equal(Step.safeParse({ ...step, answer, prompt }).success, true);
  }
});

test("MCQ options use literal matching for code-like options", () => {
  for (const answer of ["a // b", "x /* y", "a // b"]) {
    const mcq = {
      ...step,
      kind: "mcq",
      options: [answer, "other one", "other two", "other three"],
      answer: 0,
      accepted: undefined,
      prompt: "The values a and b appear in this expression.",
    };
    assert.equal(Step.safeParse(mcq).success, true);
  }
  const exact = {
    ...step,
    kind: "mcq",
    options: ["a // b", "other one", "other two", "other three"],
    answer: 0,
    accepted: undefined,
    prompt: "Enter a // b.",
  };
  assert.equal(Step.safeParse(exact).success, false);
  const short = { ...exact, options: ["c", "other one", "other two", "other three"], prompt: "What changes?" };
  assert.equal(Step.safeParse(short).success, true);
});

test("a number before a sentence period is rejected", () => {
  assertRejected({ ...step, answer: "discount = 0", prompt: "Now write discount = 0." });
});

test("tokens the grader keeps apart do not leak", () => {
  for (const [answer, prompt] of [["discount = 0", "Type discount=01 here."], ['"a b"', 'Type "ab" here.']]) {
    assert.equal(Step.safeParse({ ...step, answer, prompt }).success, true);
  }
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
