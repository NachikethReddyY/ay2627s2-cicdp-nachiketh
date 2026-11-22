import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkStep, containsAnswer, Step, type GeneratedStep } from "../src/ai/step-schema.ts";

type LeakVector = { name: string; text: string; answer: string; leaks: boolean };

const leakVectors: LeakVector[] = JSON.parse(
  readFileSync(new URL("../../../services/engine/tests/fixtures/leak_vectors.json", import.meta.url), "utf8"),
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

for (const vector of leakVectors) {
  test(`leak vector: ${vector.name}`, () => {
    assert.equal(containsAnswer(vector.text, vector.answer), vector.leaks);
  });
}
