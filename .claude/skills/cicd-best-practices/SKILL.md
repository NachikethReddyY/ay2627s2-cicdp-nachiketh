---
name: cicd-best-practices
description: CI/CD best practices for LearnQuest's GitHub Actions pipelines. Use when creating or changing a workflow under .github/workflows, adding a deploy or release job, touching CI secrets or permissions, reviewing pipeline speed or flaky tests, or when the user asks about CI/CD, DORA metrics, or how a change should be shipped.
---

# CI/CD best practices (LearnQuest)

Source of truth for the pipeline design: `docs/plan.md` §6.9 (`pr.yml`, `main.yml`, `release.yml`, reusable jobs in `.github/workflows/jobs/`). This skill says how to build those well. If the two disagree, the plan wins and the skill needs updating.

## 1. Flow and branching

- Trunk-based: short-lived branches, small PRs (aim under ~300 changed lines), merge to `main` often.
- Unfinished work goes behind a flag or stays out of the user path. Never merge half a feature that breaks `main`.
- `main` is always releasable. A red `main` is fixed first.
- Branch protection on `main`: required checks, one review once the repo is public (plan Q8), no force-push.

## 2. Build once, promote the same artifact

- Build the GHCR image once per commit SHA. Staging and prod deploy that exact SHA. Never rebuild for prod.
- Tag images with the SHA. Use a moving tag only as a convenience, never as the deploy reference.
- Rollback = redeploy the previous SHA (Render) or promote the previous deployment (Vercel). Keep both working.

## 3. Fast feedback

- Order jobs cheapest first: lint and type-check, then unit tests, then integration, then build, then e2e and scans.
- Run independent jobs in parallel. Cache pnpm and uv dependencies keyed on lockfiles.
- Target: PR pipeline under about 10 minutes. Profile when it creeps up; tests are usually the slowest stage.
- Flaky tests: quarantine them with an owner and a deadline. Do not add retries to hide them.

## 4. Security in the pipeline

- Least-privilege `GITHUB_TOKEN`: set `permissions:` at the top of each workflow to `contents: read`. Grant `id-token: write` or other writes only to the job that needs them.
- Pin third-party actions to a full commit SHA, with a comment giving the version. Let Dependabot (`github-actions` ecosystem) update them.
- Use OIDC for cloud deploys (Render, Vercel, Neon, etc.) where supported. No long-lived cloud keys in secrets.
- Never interpolate untrusted input (PR titles, branch names, issue bodies) directly into `run:`. Pass it through `env:` first.
- Be careful with `pull_request_target`. Do not check out PR head code in it.
- Scans already in the plan: `pnpm audit`, `pip-audit`, gitleaks, Trivy, CodeQL. Make them block merges for high severity.
- Hash-locked dependencies. The LiteLLM advisory check (WP0) stays on the list.
- Secrets live in the environment store, scoped per environment (`staging`, `prod`), never in the repo or logs.

## 5. Environments and deploys

- Local (compose) → staging → prod. Promote only after smoke tests pass on the previous step.
- Use GitHub Environments with required reviewers for prod. Smoke gates promotion (plan §6.9).
- Deploy jobs are idempotent: rerunning one must not break the environment.
- Concurrency: one deploy per environment at a time (`concurrency:` group), and cancel stale PR runs.
- Warm-up step before smoke, because free-tier Render services sleep.

## 6. Testing in CI

- Tests in CI use recorded fixtures for LLM calls. No live model calls in PR checks (plan §15.7).
- Every new non-trivial logic path gets a test. A failing test blocks the merge; do not skip it.
- E2E on `docker compose` in PRs once WP14 lands (Sprint 4 at the latest). Axe runs with it.

## 7. Observability of the pipeline

- Keep the workflow files readable: one job per concern, reusable jobs via `workflow_call`.
- Record DORA metrics from Actions and deploy events (plan §15.9):
  - Deployment frequency: successful prod deploys per week.
  - Lead time: commit time → prod deploy time.
  - Change failure rate: deploys that needed a rollback or hotfix.
  - Time to restore: failure detected → fixed or rolled back.
- Put the numbers in the weekly notes and the report.

## 8. Checklist before merging a workflow change

- [ ] `permissions:` is set and minimal.
- [ ] Third-party actions pinned to SHAs.
- [ ] No untrusted input in `run:`.
- [ ] Runs on a PR and shows the expected jobs green.
- [ ] Deploy jobs use the environment, concurrency group and the same SHA.
- [ ] Rollback path still works.
- [ ] Workflow runtime still under ~10 minutes for PRs.

## References

- DORA metrics definitions: deployment frequency, lead time, change failure rate, time to restore. Used in plan §15.9.
- GitHub "Security hardening for GitHub Actions" (check the official doc before relying on details, since search sources here were secondary).
