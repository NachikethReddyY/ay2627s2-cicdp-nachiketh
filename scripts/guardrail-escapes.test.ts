import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { checkRepo } from "./check-boundaries.ts";
import { checkRepoComments } from "./check-comments.ts";

const root = resolve(import.meta.dirname, "..");

test("generated-looking files are checked except the exact generated changelog", () => {
  const dir = mkdtempSync(join(tmpdir(), "guardrails-"));
  try {
    for (const top of ["apps", "packages", "e2e", "scripts", "tools"]) mkdirSync(join(dir, top));
    mkdirSync(join(dir, "packages", "sample"));
    mkdirSync(join(dir, "apps", "web", "src", "pages"), { recursive: true });
    writeFileSync(join(dir, "packages", "sample", "escape.gen.ts"), '// comment\nimport x from "@learnquest/api";\n');
    writeFileSync(join(dir, "apps", "web", "src", "pages", "changelog-releases.generated.ts"), "// generated\n");
    assert.deepEqual(checkRepoComments(dir).map((v) => v.file), ["packages/sample/escape.gen.ts"]);
    assert.deepEqual(checkRepo(dir).map((v) => v.file), ["packages/sample/escape.gen.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("boundary walker checks JavaScript and template imports", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundaries-"));
  try {
    for (const top of ["apps", "packages", "e2e", "tools"]) mkdirSync(join(dir, top));
    mkdirSync(join(dir, "packages", "sample"));
    for (const ext of ["js", "mjs"]) writeFileSync(join(dir, "packages", "sample", `escape.${ext}`), 'import x from "@learnquest/api";\n');
    writeFileSync(join(dir, "packages", "sample", "template.ts"), "const x = import(\n `@learnquest/api`);\n");
    assert.deepEqual(checkRepo(dir).map((v) => v.file).sort(), ["packages/sample/escape.js", "packages/sample/escape.mjs", "packages/sample/template.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("oxlint checks generated-looking files", () => {
  const dir = mkdtempSync(join(tmpdir(), "guardrail-fixture-"));
  try {
    const file = join(dir, "escape.gen.ts");
    writeFileSync(file, "debugger;\n");
    const result = spawnSync(join(root, "node_modules", ".bin", "oxlint"), ["-c", join(root, ".oxlintrc.json"), file], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /no-debugger/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("type-aware lint includes scripts with a project configuration", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.match(pkg.scripts["lint:types"], /\bscripts\b/);
  assert.match(pkg.scripts["lint:types"], /tsc -p scripts\/tsconfig\.json/);
  const config = JSON.parse(readFileSync(join(root, "scripts", "tsconfig.json"), "utf8"));
  assert.equal(config.compilerOptions.strict, true);
});

test("other generated-looking files, even named like the changelog, stay checked", () => {
  const dir = mkdtempSync(join(tmpdir(), "guardrails-lookalike-"));
  try {
    for (const top of ["apps", "packages", "e2e", "scripts", "tools"]) mkdirSync(join(dir, top));
    mkdirSync(join(dir, "packages", "sample"));
    mkdirSync(join(dir, "apps", "web", "src", "pages"), { recursive: true });
    writeFileSync(join(dir, "packages", "sample", "x.generated.ts"), 'import a from "@learnquest/api";\n');
    writeFileSync(join(dir, "packages", "sample", "changelog-releases.generated.ts"), 'import a from "@learnquest/api";\n');
    writeFileSync(join(dir, "apps", "web", "src", "pages", "changelog-releases.generated.ts"), 'import a from "@learnquest/api";\n// c\n');
    assert.deepEqual(checkRepo(dir).map((v) => v.file).sort(), ["packages/sample/changelog-releases.generated.ts", "packages/sample/x.generated.ts"]);
    assert.deepEqual(checkRepoComments(dir).map((v) => v.file), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("boundary check sees multiline specifiers, computed imports and every JS and TS extension", () => {
  const dir = mkdtempSync(join(tmpdir(), "boundaries-forms-"));
  try {
    for (const top of ["apps", "packages", "e2e", "tools"]) mkdirSync(join(dir, top));
    mkdirSync(join(dir, "packages", "sample"));
    const write = (name: string, text: string) => writeFileSync(join(dir, "packages", "sample", name), text);
    write("multiline.ts", 'import x from\n  "@learnquest/api";\n');
    write("reexport.ts", 'export * from\n  "@learnquest/web";\n');
    write("require.ts", 'const x = require(\n  "@learnquest/api");\n');
    write("computed.ts", 'const n = "@learnquest/api";\nconst x = import(n);\n');
    write("a.cjs", 'const x = require("@learnquest/api");\n');
    write("b.mts", 'import x from "@learnquest/api";\n');
    write("c.cts", 'import x from "@learnquest/api";\n');
    assert.deepEqual(
      checkRepo(dir).map((v) => v.file).sort(),
      ["a.cjs", "b.mts", "c.cts", "computed.ts", "multiline.ts", "reexport.ts", "require.ts"].map((n) => `packages/sample/${n}`),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a backslash in a file name does not impersonate the exempt changelog path", () => {
  const dir = mkdtempSync(join(tmpdir(), "guardrails-backslash-"));
  try {
    for (const top of ["apps", "packages", "e2e", "scripts", "tools"]) mkdirSync(join(dir, top));
    mkdirSync(join(dir, "apps", "web", "src"), { recursive: true });
    writeFileSync(join(dir, "apps", "web", "src", "pages\\changelog-releases.generated.ts"), "// c\n");
    assert.equal(checkRepoComments(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scripts type configuration covers nested scripts", () => {
  const config = JSON.parse(readFileSync(join(root, "scripts", "tsconfig.json"), "utf8"));
  assert.deepEqual(config.include, ["**/*.ts"]);
});
