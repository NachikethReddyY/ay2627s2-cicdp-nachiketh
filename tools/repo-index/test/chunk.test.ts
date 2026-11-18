import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkFile } from "../src/chunk.ts";
import { SAMPLE_FILES } from "./helpers.ts";

const symbolsOf = (path: string, text: string) => chunkFile(path, text).map((c) => c.symbol);

test("typescript yields one chunk per declaration plus a header", () => {
  const chunks = chunkFile("src/greeting.ts", SAMPLE_FILES["src/greeting.ts"]!);
  assert.deepEqual(
    chunks.map((c) => [c.symbol, c.kind]),
    [
      ["(file header)", "header"],
      ["greetLearner", "function"],
      ["DEFAULT_HINT_DEPTH", "const"],
      ["LessonPlan", "interface"],
    ],
  );
  const greet = chunks.find((c) => c.symbol === "greetLearner")!;
  assert.equal(greet.text.split("\n")[0], "src/greeting.ts :: greetLearner");
  assert.match(greet.text, /export function greetLearner/);
  assert.equal(greet.startLine, 3);
  assert.equal(greet.endLine, 5);
});

test("tsx components and exported arrow consts are separate chunks", () => {
  assert.deepEqual(symbolsOf("src/app.tsx", SAMPLE_FILES["src/app.tsx"]!), ["(file header)", "App", "Footer"]);
});

test("python splits top-level defs and classes", () => {
  const chunks = chunkFile("engine/grader.py", SAMPLE_FILES["engine/grader.py"]!);
  assert.deepEqual(
    chunks.map((c) => c.symbol),
    ["(file header)", "grade_answer", "HintGiver"],
  );
  const hintGiver = chunks.find((c) => c.symbol === "HintGiver")!;
  assert.match(hintGiver.text, /def give/);
  assert.equal(hintGiver.kind, "class");
});

test("markdown splits per heading with an intro", () => {
  assert.deepEqual(symbolsOf("docs/guide.md", SAMPLE_FILES["docs/guide.md"]!), ["Guide", "Predict before reveal", "Sandbox"]);
});

test("unknown file types use 60 line windows with 10 lines overlap", () => {
  const chunks = chunkFile("notes.txt", SAMPLE_FILES["notes.txt"]!);
  assert.deepEqual(
    chunks.map((c) => [c.startLine, c.endLine]),
    [
      [1, 60],
      [51, 110],
      [101, 130],
    ],
  );
});

test("a declaration over 120 lines is split into parts", () => {
  const body = Array.from({ length: 150 }, (_, i) => `  const v${i} = ${i};`).join("\n");
  const chunks = chunkFile("big.ts", `export function huge() {\n${body}\n}\n`);
  assert.deepEqual(
    chunks.map((c) => c.symbol),
    ["huge (part 1)", "huge (part 2)"],
  );
  assert.ok(chunks.every((c) => c.endLine - c.startLine + 1 <= 120));
});

test("empty files produce no chunks", () => {
  assert.deepEqual(chunkFile("empty.ts", "  \n"), []);
});
