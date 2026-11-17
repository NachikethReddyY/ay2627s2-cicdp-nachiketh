import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createEmbedder } from "./embed.ts";
import { indexRepo, indexStatus } from "./indexer.ts";
import { findRepoRoot } from "./repo.ts";
import { findSymbol, relatedFiles, searchCode } from "./search.ts";

const root = findRepoRoot(process.cwd());

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

async function refreshIfStale(): Promise<void> {
  if (!indexStatus(root).stale) return;
  const summary = await indexRepo(root, createEmbedder(root));
  process.stderr.write(`repo-index: indexed ${summary.changed} changed files, ${summary.chunks} chunks, ${summary.ms} ms\n`);
}

const ready = refreshIfStale().catch((error: unknown) => {
  process.stderr.write(`repo-index: auto-index failed: ${error instanceof Error ? error.message : String(error)}\n`);
});

const server = new McpServer({ name: "repo-index", version: "0.1.0" });

server.registerTool(
  "search_code",
  {
    description: "Hybrid semantic and keyword search over the repository. Returns chunks with path, symbol, line range and text.",
    inputSchema: { query: z.string(), k: z.number().int().min(1).max(50).optional() },
  },
  async ({ query, k }) => {
    await ready;
    return jsonResult(await searchCode(root, createEmbedder(root), query, k ?? 8));
  },
);

server.registerTool(
  "find_symbol",
  {
    description: "Exact then prefix lookup of a function, class, type or heading by name.",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    await ready;
    return jsonResult(findSymbol(root, name));
  },
);

server.registerTool(
  "related_files",
  {
    description: "Files that a path imports and files that import it.",
    inputSchema: { path: z.string() },
  },
  async ({ path }) => {
    await ready;
    return jsonResult(relatedFiles(root, path));
  },
);

server.registerTool(
  "index_status",
  { description: "Index size, provider, model, last index time and whether it is stale.", inputSchema: {} },
  async () => {
    await ready;
    return jsonResult(indexStatus(root));
  },
);

await server.connect(new StdioServerTransport());
