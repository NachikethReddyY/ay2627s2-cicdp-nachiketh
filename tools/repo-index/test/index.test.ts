import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { openDb } from "../src/db.ts";
import { indexRepo, indexStatus, ProviderMismatchError } from "../src/indexer.ts";
import { createFakeEmbedder } from "../src/embed.ts";
import { searchCode } from "../src/search.ts";
import { countingEmbedder, createTempRepo, type TempRepo } from "./helpers.ts";

let repo: TempRepo;

beforeEach(() => {
  repo = createTempRepo();
});

afterEach(() => {
  repo.cleanup();
});

function rowCount(sql: string, ...params: string[]): number {
  const db = openDb(repo.root);
  try {
    return (db.prepare(sql).get(...params) as { n: number }).n;
  } finally {
    db.close();
  }
}

test("first index covers every file and a second run embeds nothing", async () => {
  const embedder = countingEmbedder();
  const first = await indexRepo(repo.root, embedder);
  assert.equal(first.changed, first.filesSeen);
  assert.ok(first.chunks > 0);
  embedder.embeddedTexts.length = 0;
  const second = await indexRepo(repo.root, embedder);
  assert.equal(second.changed, 0);
  assert.equal(embedder.embeddedTexts.length, 0);
});

test("changing one file re-embeds only that file", async () => {
  const embedder = countingEmbedder();
  await indexRepo(repo.root, embedder);
  embedder.embeddedTexts.length = 0;
  repo.write("src/shout.ts", "export function shout(text: string): string {\n  return text + '!';\n}\n");
  const summary = await indexRepo(repo.root, embedder);
  assert.equal(summary.changed, 1);
  assert.ok(embedder.embeddedTexts.length > 0);
  assert.ok(embedder.embeddedTexts.every((text) => text.startsWith("src/shout.ts ::")));
});

test("deleting a file removes its rows", async () => {
  const embedder = countingEmbedder();
  await indexRepo(repo.root, embedder);
  assert.ok(rowCount("SELECT COUNT(*) AS n FROM chunks WHERE path = ?", "src/shout.ts") > 0);
  repo.remove("src/shout.ts");
  const summary = await indexRepo(repo.root, embedder);
  assert.equal(summary.removed, 1);
  assert.equal(rowCount("SELECT COUNT(*) AS n FROM chunks WHERE path = ?", "src/shout.ts"), 0);
  assert.equal(rowCount("SELECT COUNT(*) AS n FROM files WHERE path = ?", "src/shout.ts"), 0);
  assert.equal(rowCount("SELECT COUNT(*) AS n FROM imports WHERE to_path = ?", "src/shout.ts"), 0);
});

test("lockfiles, binaries and oversized files are skipped", async () => {
  repo.write("pnpm-lock.yaml", "lockfileVersion: 9\n");
  repo.write("logo.png", "not really a png");
  repo.write("huge.txt", "x".repeat(210 * 1024));
  repo.write("api.generated.ts", "export const generated = 1;\n");
  await indexRepo(repo.root, countingEmbedder());
  for (const skipped of ["pnpm-lock.yaml", "logo.png", "huge.txt", "api.generated.ts"]) {
    assert.equal(rowCount("SELECT COUNT(*) AS n FROM files WHERE path = ?", skipped), 0, skipped);
  }
});

test("gitignored files are not indexed", async () => {
  repo.write(".gitignore", "secret.txt\n");
  repo.write("secret.txt", "top secret\n");
  await indexRepo(repo.root, countingEmbedder());
  assert.equal(rowCount("SELECT COUNT(*) AS n FROM files WHERE path = ?", "secret.txt"), 0);
  assert.equal(rowCount("SELECT COUNT(*) AS n FROM files WHERE path LIKE '.repo-index%'"), 0);
});

test("status reports staleness until the index catches up", async () => {
  assert.equal(indexStatus(repo.root).stale, true);
  await indexRepo(repo.root, createFakeEmbedder());
  const fresh = indexStatus(repo.root);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.provider, "fake");
  repo.write("src/shout.ts", "export const changed = true;\n");
  assert.equal(indexStatus(repo.root).stale, true);
});

test("a different provider forces a full reindex and search refuses to mix", async () => {
  await indexRepo(repo.root, createFakeEmbedder());
  const other = { ...createFakeEmbedder(), model: "another-model" };
  await assert.rejects(searchCode(repo.root, other, "hint"), ProviderMismatchError);
  const summary = await indexRepo(repo.root, other);
  assert.equal(summary.changed, summary.filesSeen);
});

test("changing an imported file keeps its importers linked", async () => {
  await indexRepo(repo.root, createFakeEmbedder());
  repo.write("src/shout.ts", "export function shout(text: string): string {\n  return text;\n}\n");
  await indexRepo(repo.root, createFakeEmbedder());
  assert.equal(rowCount("SELECT COUNT(*) AS n FROM imports WHERE to_path = ?", "src/shout.ts"), 1);
});
