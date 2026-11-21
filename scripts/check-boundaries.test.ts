import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { checkFile, checkRepo } from "./check-boundaries.ts";
import { EFFECT_ALLOWLIST, TIMER_ALLOWLIST } from "../apps/web/eslint.allowlists.js";

const messages = (file: string, text: string) => checkFile(file, text).map((v) => v.message);

test("the repo has no violations", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.deepEqual(checkRepo(root), []);
});

test("a package may not import an app or the API", () => {
  assert.equal(checkFile("packages/player-core/src/a.ts", 'import { x } from "@learnquest/api/db";').length, 1);
  assert.equal(checkFile("packages/ui-catalog/src/a.ts", 'import { x } from "../../../apps/web/src/y.ts";').length, 1);
  assert.deepEqual(checkFile("packages/ui-catalog/src/a.ts", 'import { z } from "zod";'), []);
});

test("the API may not import the web app", () => {
  assert.equal(checkFile("apps/api/src/a.ts", 'import { x } from "@learnquest/web";').length, 1);
  assert.deepEqual(checkFile("apps/api/src/a.ts", 'import { x } from "./b.ts";'), []);
});

test("ts-ignore and bare eslint-disable are rejected, a reasoned disable is not", () => {
  assert.equal(checkFile("apps/web/src/a.ts", "// @ts-ignore").length, 1);
  assert.equal(checkFile("apps/web/src/a.ts", "// eslint-disable-next-line react-hooks/exhaustive-deps").length, 1);
  assert.deepEqual(checkFile("apps/web/src/a.ts", "// eslint-disable-next-line react-hooks/exhaustive-deps -- fires once"), []);
});

test("tests may mention the patterns", () => {
  assert.deepEqual(messages("apps/api/test/lint.test.ts", "const a = '// eslint-disable-line no-var';"), []);
});

test("a relative or dynamic cross-app import is caught", () => {
  assert.equal(checkFile("apps/api/src/a.ts", 'import { x } from "../../web/src/y.ts";').length, 1);
  assert.equal(checkFile("packages/ui-catalog/src/a.ts", 'const m = await import("@learnquest/api/db");').length, 1);
  assert.equal(checkFile("packages/ui-catalog/src/a.ts", 'import a from "zod"; import b from "@learnquest/web";').length, 1);
  assert.deepEqual(checkFile("packages/ui-catalog/src/a.ts", 'import { x } from "@learnquest/web-kit";'), []);
});

test("lesson text can quote import syntax alongside a real dependency", () => {
  const file = "packages/sample/lesson.ts";
  const lesson = [
    `const example = 'import { topic } from "@learnquest/web"';`,
    `const hint = "Try import(name) or require(name)";`,
    `const template = \`require("@learnquest/api")\`;`,
    'export { topic } from "@learnquest/web";',
  ].join("\n");
  const violations = checkFile(file, lesson);
  assert.deepEqual(violations.map(({ line }) => line), [4]);
  assert.match(violations[0].message, /@learnquest\/web/);
});

test("type imports and CommonJS module references observe package boundaries", () => {
  const file = "packages/sample/types.cts";
  const declarations = [
    'type Topic = import("@learnquest/web").Topic;',
    'import api = require("@learnquest/api");',
    'const web = module.require("@learnquest/web");',
  ].join("\n");
  assert.deepEqual(checkFile(file, declarations).map(({ line }) => line), [1, 2, 3]);
});

test("CommonJS loading is distinct from unrelated require methods", () => {
  const file = "packages/sample/loader.cjs";
  const references = [
    'module.require("@learnquest/web");',
    'module["require"]("@learnquest/web");',
    'registry.require(name);',
    'registry["require"](name);',
  ].join("\n");
  assert.deepEqual(checkFile(file, references).map(({ line }) => line), [1, 2]);
});

test("lesson parameters and local variables shadow only their own CommonJS references", () => {
  const lesson = [
    'function teach(module: { require(topic: string): void }, topic: string) {',
    '  module.require(topic);',
    '  module["require"](topic);',
    '  const require = (title: string) => title;',
    '  require(topic);',
    '  return import(topic);',
    '}',
    'module.require(topic);',
    'module["require"](topic);',
    'require(topic);',
  ].join("\n");
  assert.deepEqual(checkFile("packages/sample/lesson.cts", lesson).map(({ line }) => line), [6, 8, 9, 10]);
});

test("CommonJS calls distinguish TypeScript declarations from imported values", () => {
  const file = "packages/sample/lesson.cts";
  const declarations = [
    'import type { module } from "./lesson-types";',
    'declare const require: NodeJS.Require;',
    'module.require(topic);',
    'require(topic);',
  ].join("\n");
  assert.deepEqual(checkFile(file, declarations).map(({ line }) => line), [3, 4]);
  assert.deepEqual(checkFile(file, 'import module = require("./lesson"); module.require(topic);'), []);
});

test("constructor parameter properties shadow CommonJS only inside the constructor", () => {
  const lesson = [
    'class Lesson {',
    '  constructor(public module: { require(topic: string): void }, private require: (topic: string) => void) {',
    '    module.require(topic);',
    '    module["require"](topic);',
    '    require(topic);',
    '    import(topic);',
    '  }',
    '  teach() { module.require(topic); require(topic); }',
    '}',
    'module.require(topic); require(topic);',
  ].join("\n");
  assert.deepEqual(checkFile("packages/sample/lesson.ts", lesson).map(({ line }) => line), [6, 8, 8, 10, 10]);
});

test("value namespaces shadow module within their scope, but type-only declarations do not", () => {
  const lesson = [
    'function teach() {',
    '  namespace module { export function require(topic: string) {} }',
    '  module.require(topic);',
    '  module["require"](topic);',
    '}',
    'module.require(topic);',
    'function review() {',
    '  interface module { title: string }',
    '  module.require(topic);',
    '}',
    'import(topic);',
  ].join("\n");
  assert.deepEqual(checkFile("packages/sample/lesson.ts", lesson).map(({ line }) => line), [6, 9, 11]);
  for (const declaration of [
    'namespace module { export interface Topic { title: string } }',
    'declare namespace module { function require(topic: string): void }',
    'namespace module {}',
  ]) {
    assert.equal(checkFile("packages/sample/lesson.ts", `${declaration}\nmodule.require(topic);`).length, 1);
  }
});

test("the guardrail rules cannot be disabled", () => {
  assert.equal(checkFile("apps/web/src/a.ts", "// eslint-disable-next-line no-restricted-syntax -- needed").length, 1);
});

const MAX_EFFECT_FILES = 38;
const MAX_TIMER_FILES = 22;
const EFFECT = /\buse(Layout|Insertion)?Effect\(/;
const TIMER = /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\(/;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const [name, list, max, pattern] of [
  ["effect", EFFECT_ALLOWLIST, MAX_EFFECT_FILES, EFFECT],
  ["timer", TIMER_ALLOWLIST, MAX_TIMER_FILES, TIMER],
] as const) {
  test(`the ${name} allowlist only shrinks and has no stale entries`, () => {
    assert.ok(list.length <= max, `${name} allowlist grew to ${list.length}. Fix the new file instead of adding it.`);
    for (const f of list) {
      assert.ok(pattern.test(readFileSync(resolve(root, "apps/web", f), "utf8")), `${f} no longer uses the ${name} pattern. Remove it from apps/web/eslint.allowlists.js and lower the cap in this test.`);
    }
  });
}
