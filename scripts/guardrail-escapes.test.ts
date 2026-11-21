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
