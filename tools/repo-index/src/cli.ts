import { parseArgs } from "node:util";
import { createEmbedder } from "./embed.ts";
import { indexRepo, indexStatus } from "./indexer.ts";
import { findRepoRoot } from "./repo.ts";
import { findSymbol, relatedFiles, searchCode, type SearchHit } from "./search.ts";

const USAGE = `usage:
  repo-index index [--full]
  repo-index search "<query>" [--k 8] [--json]
  repo-index symbol <name> [--json]
  repo-index related <path> [--json]
  repo-index status [--json]`;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatHit(hit: SearchHit): string {
  const preview = hit.text.split("\n").slice(1, 4).join("\n    ");
  return `${hit.path}:${hit.startLine}-${hit.endLine}  ${hit.symbol}  [${hit.kind}]  ${hit.score.toFixed(4)}\n    ${preview}`;
}

function printHits(hits: SearchHit[], json: boolean): void {
  if (json) printJson(hits);
  else process.stdout.write(hits.length === 0 ? "no results\n" : `${hits.map(formatHit).join("\n")}\n`);
}

async function run(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      full: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      k: { type: "string", default: "8" },
    },
  });
  const [command, argument] = positionals;
  const root = findRepoRoot(process.cwd());

  if (command === "index") {
    const summary = await indexRepo(root, createEmbedder(root), { full: values.full });
    process.stdout.write(
      `files seen ${summary.filesSeen}, changed ${summary.changed}, removed ${summary.removed}, chunks ${summary.chunks}, ${summary.ms} ms\n`,
    );
    return;
  }
  if (command === "search") {
    if (!argument) throw new Error("search needs a query");
    const k = Number.parseInt(values.k, 10);
    if (!Number.isInteger(k) || k < 1) throw new Error("--k must be a positive integer");
    printHits(await searchCode(root, createEmbedder(root), argument, k), values.json);
    return;
  }
  if (command === "symbol") {
    if (!argument) throw new Error("symbol needs a name");
    printHits(findSymbol(root, argument), values.json);
    return;
  }
  if (command === "related") {
    if (!argument) throw new Error("related needs a path");
    const related = relatedFiles(root, argument);
    if (values.json) printJson(related);
    else {
      process.stdout.write(`imports:\n${related.imports.map((p) => `  ${p}`).join("\n")}\nimported by:\n${related.importedBy.map((p) => `  ${p}`).join("\n")}\n`);
    }
    return;
  }
  if (command === "status") {
    const status = indexStatus(root);
    if (values.json) printJson(status);
    else process.stdout.write(`${Object.entries(status).map(([key, value]) => `${key}: ${value}`).join("\n")}\n`);
    return;
  }
  throw new Error(USAGE);
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
