import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStep, Step, type GeneratedStep } from "../src/ai/step-schema.ts";

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
