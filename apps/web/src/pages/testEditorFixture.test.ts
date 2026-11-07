import assert from "node:assert/strict";
import test from "node:test";
import { TEST_LESSONS, designFilePaths, designTree, languageOf, pickTestLesson } from "./testEditorFixture.ts";
import { flattenTree, initialOpen } from "../player/workbench/fileTree.ts";

test("pickTestLesson returns the lesson for a known language", () => {
  assert.equal(pickTestLesson("python").fileName, "sum.py");
  assert.equal(pickTestLesson("typescript").fileName, "sum.ts");
});

test("pickTestLesson falls back to JavaScript for missing or odd values", () => {
  for (const v of [undefined, "", "rust", "toString", "__proto__", 3]) {
    assert.equal(pickTestLesson(v).language, "javascript");
  }
});

test("every lesson's file list starts with its own code file", () => {
  for (const l of Object.values(TEST_LESSONS)) assert.equal(l.files[0]?.path, l.fileName);
});

test("the design tree shows the board's rows with the lesson file in the selected slot", () => {
  const tree = designTree("sum.py");
  const rows = flattenTree(tree, initialOpen(tree));
  assert.deepEqual(
    rows.map((r) => `${r.depth}:${r.node.name}`),
    ["0:learnquest", "1:apps", "2:api", "2:web", "1:packages", "2:player-core", "3:src", "4:index.ts", "4:timeline.ts", "4:sum.py", "2:ui-catalog", "1:services", "1:docs", "1:README.md", "1:AGENTS.md", "1:DESIGN.md", "1:package.json"],
  );
  assert.equal(rows[9].node.status, "M");
  assert.ok(designFilePaths("sum.py").includes("learnquest/packages/player-core/src/sum.py"));
});

test("languageOf follows the extension, the lesson language otherwise", () => {
  assert.equal(languageOf("a/README.md", "python"), "markdown");
  assert.equal(languageOf("a/x.ts", "javascript"), "typescript");
  assert.equal(languageOf("a/sum.js", "javascript"), "javascript");
});
