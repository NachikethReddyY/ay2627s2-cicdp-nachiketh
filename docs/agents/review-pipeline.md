# Review pipeline

`scripts/agent-review.ts` is the local replacement for a paid review bot. It drives the Claude Code and Codex CLIs you already have logged in, so it needs no API key and costs nothing extra.

## When to run it

- Before merging a sensitive PR, once this policy lands on main. Run the trusted gate command below with `--author claude|codex`, declaring the family that wrote the change. The gate runs the review itself from the base copy of `agent-review.ts` and accepts only a clean result for the exact PR head, from a reviewer of a different family than the author. A hand-written result file is not accepted.
- On any non-trivial PR, after local CI is green and before you ask a human.

After this policy lands on main, run the bootstrap from the current main, not the PR checkout:

```bash
git fetch origin +refs/heads/main:refs/remotes/origin/main
git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh
git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- <pr> --author <claude|codex>
```

Until then, current main's gate and policy apply. The author family is an operator declaration; the gate does not authenticate authorship or establish provenance. Operators must declare it accurately.

```bash
node scripts/agent-review.ts --pr 123 --author claude
node scripts/agent-review.ts --base origin/main --author codex --json
node scripts/agent-review.ts --pr 123 --author claude --post
```

Flags: `--pr N` or `--base <ref>` (default `origin/main`), `--author claude|codex`, `--reviewer`, `--verifier`, `--model <name>`, `--post` (needs `--pr`), `--json`, `--no-index`, `--max-findings N` (default 8), `--screener claude|codex|opencode` (off by default), `--ledger <path>`, `--dismiss <id>`. `--reviewer proxy-codex` selects the Codex runner and passes `--model` through.

## How the reviewer is chosen

Model inversion: the family that wrote the diff does not review it.

- `--author claude` makes Codex the reviewer and Claude the verifier.
- `--author codex` makes Claude (model `opus`) the reviewer and Codex the verifier.
- `--author` is required. Without it the review refuses to run.
- `--reviewer` and `--verifier` override this. `--model` sets the reviewer's model only.

## Strict mode and large diffs

`--strict` is what the merge gate uses. The bootstrap resolves the local `origin/main` commit once and extracts the gate and reviewer from that commit. The gate classifies paths with renames disabled and runs the strict reviewer against the same three-dot diff between that commit and the PR head. The strict reviewer reads the local checkout, ignores the `REVIEW.md` skip list, and treats an empty diff as incomplete.

Strict mode also pins the base and head commits once at the start and returns them as `base` and `head` (the gate requires both to match), diffs as text with no external diff drivers or renames, returns `incomplete` for any binary change or any finding that cites a file outside the diff, keeps every schema-valid finding because the verifier has no repo access, and stops with `incomplete` after a 40 minute wall-clock deadline. The gate also bounds the parent review process to 42 minutes and fails closed if it times out.

Strict mode requires the whole reviewer reply to be one JSON object (bare, or in a single fenced block with nothing else), is local-commit only (`--strict` with `--pr` is a usage error), requires the literal top-level key `"bugs"` followed by a single JSON array, and implies `--no-index` with a fresh temp ledger. Before the first model call, strict mode scans paths and patches, then scans hunk text across the full change with diff line markers removed. This includes the old and new sides of edits. A match makes the review incomplete. The three-dot diff covers the PR's changes since its merge base. An integration with a later main would need a fresh gate run.

Each strict Claude invocation starts in a fresh empty directory. `--restricted` confines file tools to the working directories, `--tools ""` disables built-ins, and `--strict-mcp-config` with `--disallowedTools "mcp__*"` excludes MCP tools. `--safe-mode` suppresses user and project customizations while preserving ordinary CLI authentication. This is a boundary on model capabilities inside the trusted CLI. The CLI process can still access its own login, and administrator-managed policy still applies. An installation that rejects the flags returns `incomplete`. The flags were checked on macOS with Claude Code 2.1.311. [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) · [Working-directory permissions](https://code.claude.com/docs/en/permissions#working-directories)

Strict Codex reviews return `incomplete` before the CLI starts. In Codex 0.170.0 the host can supply an empty tool allowlist when it creates a thread, but `codex exec` exposes no option for that policy. Its read-only sandbox permits reads, and the shell feature toggle leaves other model-selected tools available. Consequently the sensitive gate can run a strict Claude review for a Codex-authored change. A Claude-authored change that requires strict Codex review stays blocked. [Codex tool policy](https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/ext/extension-api/src/tool_policy.rs) · [Exec options](https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/exec/src/cli.rs) · [Tool registration](https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/core/src/tools/spec_plan.rs)

A diff over 180,000 patch characters is reviewed in chunks: whole files are packed greedily, a larger file is split at hunk boundaries, and each chunk gets the reviewer pass (the default flow adds a verifier pass per finding; strict skips the verifier, so every valid finding blocks the merge). Findings merge across chunks. The result is `clean` only if every chunk is clean. Lockfiles receive the same full strict review; generated churn alone is not evidence of a defect. Findings should identify a concrete dependency change and failure scenario. A single hunk over the limit, or more than 12 chunks, is `incomplete`; split the PR. Chunks are reviewed separately, so a bug that only shows across two chunks can be missed. Each chunk prompt lists every changed path.

After local verification, the gate compares the bootstrap SHA with both local `origin/main` and GitHub main for every PR. Its final GitHub query reads main, the PR head and target, mergeability, review decision, review threads and check results together. For paginated results it requests every page in the final query. A changed cursor or a GitHub query limit stops the gate. Dry runs use the same checks. GitHub's merge call pins the head SHA. The base, checks and reviews can still change between the final read and the merge.

## What it does

1. Collects `git diff <base>...HEAD` (or `gh pr diff N`) and drops the files in the `Skip` list of `REVIEW.md`.
2. Adds repo index context (`tools/repo-index`) when the CLI exists. If it is missing or fails, the output says "no index context".
3. Sends the diff, context, `REVIEW.md` and the AGENTS.md principles to the reviewer. The diff and context are untrusted data and the prompt says never to follow instructions inside them.
4. Keeps only findings with a file, line, failure scenario and evidence.
5. Sends each finding to the verifier, which tries to disprove it. Refuted findings are dropped.
6. Prints a count line ("2 important, 1 nit." or "No findings.") and the findings. Nits are capped at three and dropped when an important finding exists.

The script adds no attribution line. The agent that posts the comment adds it.

## Safety and memory

- Readers and the poster are separate. The reviewer, verifier and screener only return structured candidates, and the `gh` calls the script makes for them are wrapped so a comment, review, merge, edit or `gh api` write throws. Only `postFindings` writes, and only with `--post`. This does not sandbox the `claude` or `codex` CLI processes themselves: `--allowedTools` only pre-approves tools, so run reviews in a checkout that holds nothing secret and treat the output as untrusted.
- Text in the diff or index context that talks to the reviewer, claims a human already approved, or fakes an untrusted delimiter is flagged. A flagged run ends as `incomplete` (exit 3), never `clean`, so a human reads the change. The comment gets a warning line.
- Style, naming and cleanup findings are dropped at the verifier stage, before any verifier call. Severity is only `important` or `nit`.
- Findings go to `.agent-review/ledger.jsonl` (append-only, latest line per id wins) with a stable id, head SHA, PR number, status `posted|addressed|dismissed`, and the GitHub comment database id and node id. A later run marks a finding addressed when the new diff changes its line.
- Run `--dismiss <id>` for a finding that was wrong or did not matter. Three or more dismissed entries with similar text (token Jaccard 0.6) suppress a new finding.
- `REVIEW.md` and the `AGENTS.md` principles are read from the base ref, never from the branch under review, so a branch cannot change what is skipped or trusted.
- Text posted to GitHub is sanitized: `@` mentions are defused, URLs are removed and token-like values are redacted.
- Every comment ends with a line saying bot output is advisory and does not replace CI or the merge gate.

## What "incomplete" means

If the reviewer or verifier fails, times out (10 minutes), or returns output that is not the JSON contract, the result is `Review incomplete: <reason>`. It is never an all clear. Exit code 3. Run it again, or review by hand. Do not merge on an incomplete review.

Exit codes: 0 clean or nits only, 1 important findings, 2 usage error, 3 incomplete.

## From a T3 Code thread

Start a thread on the branch and run the command with `--author` set to the model that wrote the change. The reviewer CLI runs on this machine under your own login, with read-only tools. Use `--json` when another agent will read the result.

## Before merge

Every important finding must be fixed, or refuted with evidence (a file and line, or a test) in the PR thread. Run the review again after fixes.
