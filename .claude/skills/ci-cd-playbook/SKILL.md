---
name: ci-cd-playbook
description: Practical CI/CD playbook for LearnQuest, built from industry guides and checked against what this repo actually runs. Use when adding or changing a GitHub Actions workflow, a required check, a Dockerfile or deploy config (Render, Vercel), dependabot, branch rules, or pipeline security; when CI is slow, flaky or red; before pushing a PR; or when asked how a change should be tested and shipped.
---

# CI/CD playbook (LearnQuest)

Rules are ordered by impact. Each one says what to do, then what this repo does today. Current wiring and known gaps are in `references/learnquest-pipeline.md`; where each rule comes from is in `references/sources.md`. Treat the external guides as general advice and the repo files as truth: read the workflow before assuming.

The older `cicd-best-practices` skill follows the aspirational design in `docs/plan.md` §6.9 (pr.yml, main.yml, GHCR, staging and prod). This one describes what exists in `.github/` now. If they disagree about the current state, trust the files.

## Priority index

| # | Area | Impact |
|---|------|--------|
| 1 | Keep `main` green and releasable | CRITICAL |
| 2 | Pipeline security | CRITICAL |
| 3 | Fast feedback | HIGH |
| 4 | Test layering and flakiness | HIGH |
| 5 | Build once, promote the artifact | HIGH |
| 6 | Deploy, rollback, migrations | HIGH |
| 7 | Pipeline as code | MEDIUM |
| 8 | Measure the pipeline | MEDIUM |

## 1. Keep `main` green and releasable (CRITICAL)

- Small PRs, merged often. A red `main` or red PR is fixed before new work. The size labeler tags every PR and warns from the XL tier (500+ changed lines, lockfiles excluded); aim for under ~300.
- Run the same commands locally that CI runs, before every push: `pnpm exec turbo run lint test build` with API tests on a real Postgres (see the `test-locally-before-push` memory for the container setup). Turbo does not cover the Python engine: if `services/engine` changed, also run `uv sync --frozen`, `uv run ruff check learnquest_engine tests scripts`, `uv run mypy --strict learnquest_engine` and `uv run pytest` there. Never push a DB test you only typechecked.
- Never bypass the pipeline for an "urgent" or tiny change. The `main` ruleset requires checks `lint`, `unit` and `engine`, a strict (up-to-date) branch, linear history and squash or rebase merges. Do not weaken it to get a change through.
- Renaming or removing a job changes a required check name. Update `.github/rulesets/main.json` and the live ruleset in the same change, or merges block.
- Unfinished work stays behind a flag or off the user path. Do not merge a half feature that breaks `main`.

## 2. Pipeline security (CRITICAL)

- Set `permissions:` at workflow level to the minimum (`contents: read`, or `{}`); widen per job only where a write is needed.
- Pin every third-party action to a full commit SHA with a `# vX.Y.Z` comment. Dependabot's `github-actions` group keeps them current.
- Never put untrusted text (PR title, branch name, issue body, commit message) inside `run:` or `script:` via `${{ }}`. Pass it through `env:` and read the variable, as `pr-automation.yml` does with `PR_TITLE`.
- `pull_request_target` only for jobs that call the GitHub API and never check out or run PR code. Keep the comment in `pr-automation.yml` true.
- Secrets: only in GitHub or the host's secret store, scoped to the environment that needs them, never echoed or baked into images or artifacts. CI test values (like the fixed `BETTER_AUTH_SECRET`) must be obviously fake and non-production.
- Lockfile installs only: `pnpm install --frozen-lockfile`, `uv sync --frozen`. Keep the exact-pin LiteLLM advisory check.
- Dependency, secret and code scanning belong in the pipeline, not after it (gaps are listed in the reference file). Make high severity block merges once added.
- Containers run as a non-root user and ship without the compiler toolchain (see `infra/docker/api.Dockerfile`).

## 3. Fast feedback (HIGH)

- Order work cheapest first: lint and types, then unit, then integration, then build, then e2e and scans. Fail fast.
- Run independent jobs in parallel (`unit`, `engine` and `e2e` already do, after `lint`). Cache dependencies keyed on lockfiles (`setup-node` with `cache: pnpm`).
- Add `concurrency` with `cancel-in-progress: true` for PR runs and `timeout-minutes` on every job, so superseded or hung runs do not burn minutes.
- Use path filters or turbo's task graph to skip work a change cannot affect, but never on a required check unless a skipped check still reports success.
- Aim for a PR pipeline of roughly 10 minutes or less. When it creeps up, profile the slowest step first (locally the API test suite takes about two minutes, the longest single task).

## 4. Test layering and flakiness (HIGH)

- Pyramid: many fast unit tests, fewer integration tests against real Postgres, a handful of e2e flows on high-risk paths.
- CI never calls live LLM or media providers. Use fixtures and injected clients (the tests already stub moderation). Live tests stay opt-in (`*.live.test.ts`).
- A flaky test is quarantined or fixed with an owner, not retried into passing. Never add `retry` to hide one.
- Every new logic path ships with a test. A failing test blocks the merge; do not skip it.
- DB tests refuse to run unless the database name ends `_test`. Keep that guard.
- Coverage numbers (guides suggest 70 to 80%) are a smell detector, not a goal. Prefer testing risky paths.

## 5. Build once, promote the artifact (HIGH)

- Build one immutable artifact per commit and promote that exact thing; do not rebuild per environment. Configuration comes in at deploy time, never baked into the build.
- Tag images by commit SHA. A moving tag is a convenience, never the deploy reference.
- Today Vercel builds the web app and Render builds the API image from `infra/docker/api.Dockerfile` on their own. If a registry or deploy workflow is added, it must build once and deploy that SHA to staging and prod.

## 6. Deploy, rollback, migrations (HIGH)

- The pipeline is the only path to production. No hand edits on a running service.
- Deploys are idempotent and serialized per environment (`concurrency` group, no cancel for deploy jobs).
- Every deploy has a smoke check after it (warm the service first: free-tier Render sleeps) and a rollback path: redeploy the previous SHA on Render, promote the previous deployment on Vercel.
- Database changes are versioned Drizzle migrations in `apps/api/drizzle/`, generated with `pnpm --filter @learnquest/api db:generate`, committed with the schema change, and written to be backward compatible with the previous app version (add before use, remove after). Never edit an applied migration.
- Prefer progressive delivery (feature flag, canary or blue-green) for risky changes once the platform supports it.

## 7. Pipeline as code (MEDIUM)

- Workflow changes are reviewed like app code. One job per concern; reuse via `workflow_call` instead of copy-paste.
- Keep workflow logic thin: put real logic in scripts or turbo tasks that run locally the same way.
- Dependabot covers actions, npm, uv and docker with weekly grouped updates and conventional-commit prefixes. Add an ecosystem there when adding a new kind of dependency.
- PR titles follow Conventional Commits; `pr-automation.yml` enforces them and labels by type, area and size.

## 8. Measure the pipeline (MEDIUM)

- Track the four DORA numbers: deployment frequency, lead time for changes, change failure rate, time to restore. Published benchmarks (one guide): elite change failure rate under 15%, restore under an hour. Use them as levers, not vanity targets.
- Add build duration, queue time, flaky-test count and rollback rate. Review them on a schedule and remove checks nobody acts on.

## Before merging a workflow change

- [ ] `permissions:` minimal; actions pinned to SHAs with version comments
- [ ] No untrusted input interpolated into `run:` or `script:`
- [ ] `concurrency` and `timeout-minutes` set
- [ ] Required check names still match `.github/rulesets/main.json`
- [ ] Ran green on a PR and the expected jobs appear
- [ ] Same commands pass locally (`pnpm exec turbo run lint test build`, plus the engine's ruff, mypy and pytest if `services/engine` changed)
- [ ] Rollback and smoke steps still work for any deploy-related change
