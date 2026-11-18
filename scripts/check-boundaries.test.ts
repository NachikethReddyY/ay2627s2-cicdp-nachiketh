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
