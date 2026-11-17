import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTempRepo, type TempRepo } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
let repo: TempRepo;

before(() => {
  repo = createTempRepo();
});

after(() => {
  repo.cleanup();
});

function cli(...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: repo.root,
    encoding: "utf8",
    env: { ...process.env, REPO_INDEX_PROVIDER: "fake" },
  });
}

test("index prints a one line summary", () => {
  const result = cli("index");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^files seen \d+, changed \d+, removed \d+, chunks \d+, \d+ ms$/);
});

test("status --json has the contract fields", () => {
  const result = cli("status", "--json");
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(status).sort(), ["chunks", "files", "indexedAt", "model", "provider", "stale"]);
  assert.equal(status.provider, "fake");
  assert.equal(status.stale, false);
  assert.equal(typeof status.files, "number");
});

test("search --json prints an array of hits and honours --k", () => {
  const result = cli("search", "greetLearner", "--k", "2", "--json");
  assert.equal(result.status, 0, result.stderr);
  const hits = JSON.parse(result.stdout);
  assert.ok(Array.isArray(hits));
  assert.ok(hits.length <= 2);
  assert.deepEqual(Object.keys(hits[0]).sort(), ["endLine", "kind", "path", "score", "startLine", "symbol", "text"]);
});

test("symbol --json finds a declaration", () => {
  const hits = JSON.parse(cli("symbol", "shout", "--json").stdout);
  assert.equal(hits[0].path, "src/shout.ts");
});

test("related --json lists importers", () => {
  const related = JSON.parse(cli("related", "src/shout.ts", "--json").stdout);
  assert.deepEqual(related.importedBy, ["src/greeting.ts"]);
});

test("errors exit 1 with a message on stderr", () => {
  const result = cli("search");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs a query/);
  assert.equal(result.stdout, "");
});

test("an unknown command exits 1", () => {
  assert.equal(cli("nope").status, 1);
});
