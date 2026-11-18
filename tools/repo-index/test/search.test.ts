import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createFakeEmbedder } from "../src/embed.ts";
import { indexRepo } from "../src/indexer.ts";
import { fuseRankings, findSymbol, relatedFiles, searchCode, toFtsQuery } from "../src/search.ts";
import { createTempRepo, type TempRepo } from "./helpers.ts";

let repo: TempRepo;
const embedder = createFakeEmbedder();

before(async () => {
  repo = createTempRepo();
  await indexRepo(repo.root, embedder);
});

after(() => {
  repo.cleanup();
});

test("hybrid search finds a symbol by exact name", async () => {
  const hits = await searchCode(repo.root, embedder, "greetLearner", 3);
  assert.equal(hits[0]?.symbol, "greetLearner");
  assert.equal(hits[0]?.path, "src/greeting.ts");
});

test("hybrid search finds a concept by words", async () => {
  const hits = await searchCode(repo.root, embedder, "predict before reveal prediction", 3);
  assert.equal(hits[0]?.path, "docs/guide.md");
  assert.equal(hits[0]?.symbol, "Predict before reveal");
});

test("search results have the documented shape", async () => {
  const [hit] = await searchCode(repo.root, embedder, "shout", 1);
  assert.deepEqual(Object.keys(hit!).sort(), ["endLine", "kind", "path", "score", "startLine", "symbol", "text"]);
});

test("findSymbol returns exact matches before prefix matches", () => {
  const hits = findSymbol(repo.root, "Foot");
  assert.deepEqual(hits.map((h) => h.symbol), ["Footer"]);
  const exact = findSymbol(repo.root, "App");
  assert.equal(exact[0]?.symbol, "App");
  assert.equal(exact[0]?.score, 1);
});

test("relatedFiles lists imports in both directions", () => {
  assert.deepEqual(relatedFiles(repo.root, "src/greeting.ts"), {
    path: "src/greeting.ts",
    imports: ["src/shout.ts"],
    importedBy: ["src/app.tsx"],
  });
});

test("reciprocal rank fusion rewards agreement between rankers", () => {
  const fused = fuseRankings([[1, 2, 3], [3, 4]], 3);
  assert.equal(fused[0]?.id, 3);
});

test("fts queries are quoted tokens joined by OR", () => {
  assert.equal(toFtsQuery("what's a (loop)?"), '"what" OR "s" OR "a" OR "loop"');
  assert.equal(toFtsQuery("!!!"), "");
});
