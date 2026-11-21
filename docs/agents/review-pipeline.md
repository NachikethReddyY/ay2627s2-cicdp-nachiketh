# Review pipeline

`scripts/agent-review.ts` is the local replacement for a paid review bot. It drives the Claude Code and Codex CLIs you already have logged in, so it needs no API key and costs nothing extra.

## When to run it

- Before merging a sensitive PR. Run the trusted gate command from AGENTS.md (Merging) with `--author claude|codex`, naming the family that wrote the change. The gate runs the review itself from the base copy of `agent-review.ts` and accepts only a clean result for the exact PR head, from a reviewer of a different family than the author. A hand-written result file is not accepted.
- On any non-trivial PR, after local CI is green and before you ask a human.

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

## Strict mode

The merge gate runs `agent-review.ts --strict`. Strict mode ignores the `REVIEW.md` skip list, so every changed file is reviewed, and it starts the model CLIs from an empty temporary directory, so a PR cannot steer them through `AGENTS.md`, `CLAUDE.md` or project settings in its checkout. A diff over 180,000 characters returns `incomplete`, never `clean`. The `incomplete` result also covers flagged injection text and any reviewer failure, and the gate treats it as not clean.

## Before merge

Every important finding must be fixed, or refuted with evidence (a file and line, or a test) in the PR thread. Run the review again after fixes.
