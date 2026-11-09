# LearnQuest pipeline: what exists, and the gaps

Checked against the repo on 2026-11-06. Re-read the files before relying on this.

## What exists

| Piece | File | Notes |
|---|---|---|
| CI | `.github/workflows/ci.yml` | Runs on PRs and pushes to `main`. `permissions: contents: read`. |
| Job `lint` | same | No Postgres. Runs first (10 min). `pnpm exec turbo run lint` (tsc, eslint), then the engine's ruff and `mypy --strict`. |
| Job `unit` | same | `needs: lint` (20 min). Postgres 16 service, Node 22, pnpm cache, `pnpm exec turbo run test build`. |
| Job `engine` | same | `needs: lint` (20 min). `uv sync --frozen`, pytest, plus the LiteLLM advisory check on the exact pin. |
| Job `e2e` | same | `needs: lint` (30 min). Playwright Chromium with `~/.cache/ms-playwright` cached, runs `pnpm --filter @learnquest/e2e run ci`. Each step is gated on `hashFiles('e2e/package.json')`, because a job-level `if` cannot call `hashFiles`. Skipped steps stay green until the package lands. |
| PR automation | `.github/workflows/pr-automation.yml` | `pull_request_target`, no checkout, `permissions: {}` at top and per job, `concurrency` cancel-in-progress. Size, area and type labels, semantic title check, draft state. |
| Labels, stale | `labels.yml`, `stale.yml` | Housekeeping only. |
| Dependabot | `.github/dependabot.yml` | github-actions, npm, uv, docker; weekly, grouped, `ci:` and `build:` prefixes. |
| Branch rules | `.github/rulesets/main.json` | Required checks `check` and `engine` (`check` is renamed to `lint` and `unit` in ci.yml; the ruleset is not yet updated), strict status checks, linear history, squash or rebase, threads resolved, no deletion or force-push, 0 required approvals. |
| Tag rules | `.github/rulesets/tags.json` | `v*` tags cannot be deleted, moved or updated. |
| Turbo | `turbo.json` | `build`, `lint`, `test` (test env: `TEST_DATABASE_URL`, `BETTER_AUTH_SECRET`). |
| API image | `infra/docker/api.Dockerfile` | Multi-stage, compiles `node-pty` in the build stage only, runs as `node`, `--frozen-lockfile`. |
| Web hosting | `apps/web/vercel.json` | CSP headers, `/api` rewrite to Render, SPA fallback. |

All third-party actions are pinned to SHAs.

## Gaps (candidates for follow-up PRs, not yet done)

1. `ci.yml` now has a `concurrency` group (PR runs cancel) and `timeout-minutes` on every job. Still open: the ruleset check names (see Branch rules).
2. No dependency audit (`pnpm audit`, `pip-audit`), secret scan or code scanning (CodeQL) in CI.
3. The `e2e` job is wired but skipped until `e2e/` exists on the branch. Axe is not yet in it.
4. No deploy or smoke workflow in the repo. Deploys happen through Vercel and Render's own git integration, so there is no repo-visible SHA promotion, smoke check or rollback automation. `docs/plan.md` §6.9 describes a larger design (pr.yml, main.yml, GHCR, staging and prod) that has not been built.
5. No pipeline metrics (DORA, build duration, flaky tests).
6. Turbo uses only its local cache; there is no remote cache.
7. Required review count is 0 (fine solo; revisit when the team grows).
8. Docker Hub base images are tag-pinned (`node:22-slim`), not digest-pinned.

## Local pre-push check

Run `pnpm exec turbo run lint test build` with `TEST_DATABASE_URL` pointing at a throwaway Postgres whose database name ends `_test`. See the `test-locally-before-push` memory for the exact container command.

Turbo covers only the pnpm workspaces. The `engine` job is separate, so when `services/engine` changes also run, from that directory: `uv sync --frozen`, `uv run ruff check learnquest_engine tests scripts`, `uv run mypy --strict learnquest_engine`, `uv run pytest`.
