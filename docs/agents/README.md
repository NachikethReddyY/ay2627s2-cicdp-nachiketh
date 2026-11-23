# Agent environment

How coding agents work in this repo. Start with `AGENTS.md`; this page is the map.

## Principle

Fix the foundations before building on top. A strong inner loop (types, lint, boundaries, tests) lets agents move fast without adding slop. Automation on a weak loop only makes more slop. See "Foundations first" in `AGENTS.md`.

## Layers, most reliable first

| Layer | What | Where |
|---|---|---|
| Code | Types, type-aware lint, comment ban, boundaries, effect and timer ratchets | `.oxlintrc.json`, `apps/web/eslint.config.js`, `scripts/check-*.ts` |
| Verification | Unit, property and e2e tests, revert rate | `*.property.test.ts`, `e2e/`, `scripts/revert-rate.ts` |
| Context | Local vector and symbol index of the repo, served over MCP | `tools/repo-index`, `docs/agents/repo-index.md` |
| Review | A different model reviews the diff, a verifier tries to refute each finding | `scripts/agent-review.ts`, `docs/agents/review-pipeline.md` |
| Merge | A gate that merges only when everything is green | `scripts/merge-gate.ts` |
| Prose | AGENTS.md, skills | last resort |

## The loop for one change

1. Work on a branch. Use `docs/feature-map.md` names for screens and features.
2. Run `pnpm agent:verify` against a Postgres database whose name ends in `_test`. Set `TEST_DATABASE_URL` to use a database other than the default `learnquest_test`. Fix every failure at its cause.
3. When useful, review with another model using `node scripts/agent-review.ts --author codex`. Set the value to the family that authored the changes.
4. Open the PR. A PR for a technical change carries a Mermaid diagram (see the `file-pr` skill).
5. Use the trusted bootstrap command in [AGENTS.md](../../AGENTS.md#merging) for every PR. See [the merge gate guide](merge-gate.md) and [stacking PRs](stacking-prs.md).

## GitHub Actions

The [CI workflow](../../.github/workflows/ci.yml) runs five checks in parallel (`lint`, `unit`, `engine`, `deploy-scripts`, and `e2e`). The unit job runs up to four API test files at a time, with a separate Postgres database per file and one coverage report for the whole API suite. Those databases live in the job's disposable Postgres service. Local API tests use one database and run serially. The E2E job builds the API and engine service images together through [Docker Bake](../../infra/docker/e2e.hcl), then runs the browser suite against Compose.

On pushes to `main`, successful checks lead to `Prod / Images`, `Prod / Migrate`, `Prod / Rollout`, and `Prod / Verify`. The smoke check gives the API, engine, and web endpoint up to 300 seconds each to report the deployed commit. The verification job writes the checked commit and smoke result to the run summary.

The **Summary** job runs after the checks and any production jobs finish. Its table links to job logs and includes durations, API coverage, and Playwright results when available. The Playwright artifact includes the HTML report and any traces captured on failure.

## Where things live

| Path | Contents |
|---|---|
| `apps/`, `packages/`, `services/` | Product code |
| `tools/` | Developer and agent tooling, not shipped |
| `scripts/` | Repo scripts with tests: checks, merge gate, review, metrics |
| `docs/agents/` | This page and the agent tool guides |
| `docs/design/` | Design references |
| `docs/diagrams/` | Architecture and state diagrams |
| `docs/adr/` | Decisions |
| `e2e/` | Playwright suite and fake LLM |
