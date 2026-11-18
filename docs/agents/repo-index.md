# Repo index

A local, free index of this repo for coding agents and review bots. It offers both hybrid semantic search and exact lookup, because agentic search (grep, symbol, follow the imports) often beats pure RAG.

- Storage: `<repo>/.repo-index/index.sqlite` (node:sqlite, FTS5 plus float32 embeddings). The directory ignores itself, so it is local only and never committed.
- Chunks: one per top-level TS/JS declaration, markdown heading, Python def or class; 60-line windows for everything else. Gitignored files, lockfiles, binaries, generated files and files over 200KB are skipped.
- Incremental: only files whose sha256 changed are re-embedded. Changing provider or model forces a full reindex.

## Run

```bash
pnpm --filter @learnquest/repo-index index
node tools/repo-index/src/cli.ts index [--full]
node tools/repo-index/src/cli.ts search "predict before reveal" [--k 8] [--json]
node tools/repo-index/src/cli.ts symbol greetLearner [--json]
node tools/repo-index/src/cli.ts related apps/api/src/app.ts [--json]
node tools/repo-index/src/cli.ts status [--json]
```

The CLI works from any directory inside the repo. Exit code is 0 on success and 1 on error with the message on stderr. `--json` search and symbol output is an array of `{path, symbol, kind, startLine, endLine, score, text}`. `status --json` is `{files, chunks, provider, model, indexedAt, stale}`.

The first run with the default provider downloads `Xenova/bge-small-en-v1.5` (about 35MB) into `.repo-index/models`.

## MCP server

Tools: `search_code(query, k)`, `find_symbol(name)`, `related_files(path)`, `index_status()`. Results are JSON text. The server runs an incremental index on start when the index is stale.

```bash
claude mcp add repo-index -- node tools/repo-index/src/mcp.ts
codex mcp add repo-index -- node tools/repo-index/src/mcp.ts
```

Codex can also use `~/.codex/config.toml`:

```toml
[mcp_servers.repo-index]
command = "node"
args = ["tools/repo-index/src/mcp.ts"]
```

## Environment

| Variable | Meaning |
|---|---|
| `REPO_INDEX_PROVIDER` | `local` (default), `openai`, or `fake` (tests only) |
| `REPO_INDEX_BASE_URL` | OpenAI-compatible base URL, such as LiteLLM or Ollama (`http://localhost:11434/v1`) |
| `REPO_INDEX_MODEL` | Embedding model name for the `openai` provider |
| `REPO_INDEX_API_KEY` | Bearer token, if the endpoint needs one |
