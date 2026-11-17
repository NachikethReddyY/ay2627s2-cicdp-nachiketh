import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepoComments, findBannedComments, stripComments } from "./check-comments.ts";

test("the repo has no banned comments", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.deepEqual(checkRepoComments(root), []);
});

test("line, block and trailing comments are banned", () => {
  assert.equal(findBannedComments("a.ts", "// why\nconst a = 1; /* x */\nconst b = 2; // y\n").length, 3);
});

test("slashes inside strings and templates are not comments", () => {
  assert.deepEqual(findBannedComments("a.ts", 'const u = "http://x.y"; const t = `// not ${1} /* one */`;'), []);
});

test("directives with a reason are allowed, bare ones are not", () => {
  assert.deepEqual(findBannedComments("a.ts", "// eslint-disable-next-line no-var -- legacy global\nvar a = 1;\n// @ts-expect-error -- test of bad input\nconst b: number = 'x';\n"), []);
  assert.equal(findBannedComments("a.ts", "// eslint-disable-next-line no-var\nvar a = 1;\n").length, 1);
  assert.equal(findBannedComments("a.ts", "// @ts-expect-error\nconst b: number = 'x';\n").length, 1);
});

test("jsx comments are banned", () => {
  assert.equal(findBannedComments("a.tsx", "export const A = () => <div>{/* hi */}<b /></div>;\n").length, 1);
});

test("stripping removes whole-line and trailing comments and keeps code", () => {
  const src = "// head\nconst a = 1; // tail\n/** doc */\nexport function f() {\n  return a; /* x */\n}\n";
  const out = stripComments("a.ts", src);
  assert.equal(out, "const a = 1;\nexport function f() {\n  return a;\n}\n");
  assert.deepEqual(findBannedComments("a.ts", out), []);
});

test("stripping a jsx comment removes the empty expression", () => {
  const out = stripComments("a.tsx", "export const A = () => (\n  <div>\n    {/* hi */}\n    <b />\n  </div>\n);\n");
  assert.equal(out, "export const A = () => (\n  <div>\n    <b />\n  </div>\n);\n");
});

test("stripping keeps strings and allowed directives", () => {
  const src = 'const u = "http://x.y"; // note\n// eslint-disable-next-line no-var -- legacy\nvar a = 1;\n';
  assert.equal(stripComments("a.ts", src), 'const u = "http://x.y";\n// eslint-disable-next-line no-var -- legacy\nvar a = 1;\n');
});

test("a shebang survives stripping", () => {
  assert.equal(stripComments("a.ts", "#!/usr/bin/env node\n// x\nconst a = 1;\n"), "#!/usr/bin/env node\nconst a = 1;\n");
});

test("file-level and rule-less disables are banned", () => {
  assert.equal(findBannedComments("a.ts", "/* eslint-disable -- legacy */\nconst a = 1;\n").length, 1);
  assert.equal(findBannedComments("a.ts", "// eslint-disable-next-line -- legacy\nvar a = 1;\n").length, 1);
  assert.equal(findBannedComments("a.ts", "// oxlint-disable -- legacy\nvar a = 1;\n").length, 1);
  assert.deepEqual(findBannedComments("a.ts", "// eslint-disable-next-line no-var, eqeqeq -- legacy global\nvar a = 1;\n"), []);
});
