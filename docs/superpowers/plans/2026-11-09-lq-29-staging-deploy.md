# LQ-29 Deploy to Staging With Smoke Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every push to `main` builds the API and engine images once, tags them with the commit SHA, deploys that SHA to a staging environment on Render and Vercel, and passes a smoke gate that proves the new SHA is live before the run is green.

**Architecture:** One workflow, `.github/workflows/deploy-staging.yml`, with four jobs: `build` (GHCR, SHA tag), `migrate` (expand-only, against staging DB), `deploy` (GitHub Environment `staging`: Render deploy hooks plus a Vercel production deploy of a separate staging project), and `smoke` (waits for the new SHA on `/api/healthz`, then checks the web origin). A concurrency group serialises deploys. The smoke script is plain shell so it runs locally and in CI against any origin.

**Tech Stack:** GitHub Actions, GHCR (`docker/build-push-action`), Render deploy hooks (`imgURL` as query parameter), Vercel CLI (pinned version), bash + curl for smoke, Python `http.server` for the smoke test stubs.

**Spec:** `docs/api-plan.md` §deploy (lines 212–244), `docs/plan.md` WP13 (line 538) and the CI/CD notes around lines 170–175.

## Global Constraints

- Build the GHCR image once per commit SHA; the tag is `${{ github.sha }}`. Staging and any later prod promotion use the same image.
- Staging deploys come only from `main`, via GitHub Environment `staging`. Secrets and vars live on that environment, not at repo level. The environment has a deployment branch policy limited to `main`.
- Concurrency group `deploy-staging`, `cancel-in-progress: false` (never cancel a deploy mid-flight).
- Top-level `permissions: contents: read`. Jobs elevate only what they use (`packages: write` for the build job).
- Third-party actions pinned to full commit SHAs with a version comment. The Vercel CLI is run as `npx vercel@<exact version>`, not as an action.
- Every job has `timeout-minutes`.
- No `${{ ... }}` expression of a `vars.*`, `secrets.*` or `github.event.*` value inside `run:`; pass it through `env:` and reference the shell variable.
- Smoke runs after deploy, before the workflow is green.
- Rollback path stays documented: redeploy the previous SHA on Render, or promote the previous Vercel deployment.

## Review Focus

1. **Missing or wrong staging secret** → the deploy must fail loudly, not skip and report green. Test: `render-deploy.sh` exits non-zero when the hook URL is empty.
2. **Render returns before the new image is live** → smoke must not pass on the old container. Test: smoke fails when `/api/healthz` reports a different SHA than expected, and passes when it matches.
3. **Same SHA rerun or old-run rerun** → rerunning the head SHA must not break staging; rerunning an older SHA must not roll staging back. Test: the deploy script refuses a SHA that is not the current `main` head (checked by a shell test with a stubbed `git ls-remote`).
4. **Render cold start longer than the warm-up budget** → smoke retries until a single budget (default 300 s, covering cold start and rollout) is spent, then fails with the last status logged. Test: stub returns 503 three times then the right SHA passes; a stub that never recovers fails within `SMOKE_BUDGET_S`.
5. **Auth bypass on a protected route** → smoke must fail if the protected tRPC procedure returns 200 instead of 401. Test: stub returns 200 on the protected route, smoke exits non-zero.

---

### Task 1: Expose the build SHA on `/api/healthz`

**Files:**
- Modify: `apps/api/src/app.ts:127` (the `/healthz` handler)
- Modify: `infra/docker/api.Dockerfile` (accept `GIT_SHA` build arg, set env `GIT_SHA`)
- Test: `apps/api/src/app.test.ts` (or the nearest existing health test; find it with `grep -rn "healthz" apps/api/src`)

**Interfaces:**
- Consumes: env `GIT_SHA` (string, defaults to `"unknown"` when unset).
- Produces: `GET /api/healthz` returns `{ "ok": true, "sha": "<GIT_SHA>" }` with status 200.

- [ ] **Step 1: Write the failing test**

Assert that with `process.env.GIT_SHA = "abc123"`, `GET /api/healthz` returns status 200 and body `sha` equal to `"abc123"`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @learnquest/api test -- healthz`
Expected: FAIL, `sha` is undefined.

- [ ] **Step 3: Implement**

Read `GIT_SHA` in the handler, default `"unknown"`. Add `ARG GIT_SHA` and `ENV GIT_SHA=$GIT_SHA` to the Dockerfile's final stage.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @learnquest/api test -- healthz`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/**/*.test.ts infra/docker/api.Dockerfile
git commit -m "feat(api): report build sha on healthz"
```

---

### Task 2: Smoke script with stub-server tests

**Files:**
- Create: `scripts/smoke.sh`
- Create: `scripts/smoke.test.sh`
- Create: `scripts/smoke-stub.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `scripts/smoke.sh <api-origin> <web-origin> <expected-sha>` exits 0 only when all checks pass. Checks, in order:
  1. `GET {api}/api/healthz` returns 200 and `sha == expected-sha`, retried every 3 s until `SMOKE_ROLLOUT_BUDGET_S` (default 300) is spent. The first 90 s covers cold start; the budget covers rollout.
  2. `GET {api}/api/readyz` returns 200.
  3. `GET {api}/api/trpc/home.get` returns 401 (protected procedure).
  4. `GET {web}/` returns 200 and `GET {web}/api/trpc/home.get` returns 401 (proves the Vercel rewrite reaches the API).
- Every attempt is logged as `check=<name> status=<code> sha=<value>`.
- `SMOKE_ROLLOUT_BUDGET_S` overrides the default so tests run fast.

- [ ] **Step 1: Write the failing test**

`scripts/smoke.test.sh` starts `smoke-stub.py` on a free port with a mode argument, runs `smoke.sh`, and asserts exit code. Cases:
- `ok`: healthz returns the expected SHA, all other checks pass → exit 0.
- `stale`: healthz returns the old SHA always → exit non-zero, log contains `sha=old`.
- `cold`: healthz returns 503 for the first 3 calls then correct SHA → exit 0.
- `open`: protected tRPC route returns 200 → exit non-zero.

- [ ] **Step 2: Run to verify it fails**

Run: `bash scripts/smoke.test.sh`
Expected: FAIL, `scripts/smoke.sh: No such file or directory`.

- [ ] **Step 3: Implement the stub and the script**

`smoke-stub.py` takes a mode from argv and serves the four routes with `http.server`. `smoke.sh` uses `curl -s -o /dev/null -w '%{http_code}'` plus `curl -s` and `jq -r .sha` for healthz. Read origins and SHA from `$1 $2 $3` into variables first.

- [ ] **Step 4: Run to verify it passes**

Run: `bash scripts/smoke.test.sh`
Expected: four PASS lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke.sh scripts/smoke.test.sh scripts/smoke-stub.py
git commit -m "test(ci): add staging smoke script with stub tests"
```

---

### Task 3: Build and push images once per SHA

**Files:**
- Create: `.github/workflows/deploy-staging.yml`

**Interfaces:**
- Consumes: `infra/docker/api.Dockerfile` (context repo root), `services/engine/Dockerfile`.
- Produces: job `build` with outputs `api_image` and `engine_image`, each `ghcr.io/<owner-lowercase>/learnquest-api:${{ github.sha }}` and `ghcr.io/<owner-lowercase>/learnquest-engine:${{ github.sha }}`. Build passes `GIT_SHA=${{ github.sha }}` as a build arg to the api image. The job skips the build (and reuses) when the tag already exists, so an image is built at most once per SHA.

- [ ] **Step 1: Write the failing check**

Run: `actionlint .github/workflows/deploy-staging.yml`
Expected: FAIL, file not found.

- [ ] **Step 2: Create the workflow with the build job**

Triggers: `push` to `main`, `workflow_dispatch`. Top-level `permissions: contents: read`. Concurrency `deploy-staging`, `cancel-in-progress: false`. Build job: `if: github.ref == 'refs/heads/main'`, `permissions: contents: read, packages: write`, `docker/login-action`, `docker/setup-buildx-action`, `docker/build-push-action` for both images, `timeout-minutes: 30`. Pin each action to a SHA with a version comment. Lowercase the owner with `${GITHUB_REPOSITORY_OWNER,,}` inside a shell step that writes to `$GITHUB_OUTPUT`.

- [ ] **Step 3: Verify lint**

Run: `actionlint .github/workflows/deploy-staging.yml`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-staging.yml
git commit -m "ci(deploy): build api and engine images per sha to ghcr"
```

---

### Task 4: Migrate, deploy and smoke

**Files:**
- Create: `scripts/render-deploy.sh`
- Create: `scripts/render-deploy.test.sh`
- Create: `scripts/render-vercel-config.sh`
- Create: `scripts/render-vercel-config.test.sh`
- Modify: `apps/web/vercel.json` (committed file stays valid for production; no change to prod host)
- Modify: `.github/workflows/deploy-staging.yml`

**Interfaces:**
- Consumes: `build` outputs; environment `staging` secrets `DATABASE_URL`, `RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOK_ENGINE`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; environment vars `API_ORIGIN`, `ENGINE_ORIGIN`, `WEB_ORIGIN`.
- Produces:
  - `scripts/render-deploy.sh <hook-base-url> <image-ref>` calls `curl -fsS -X POST "<hook-base-url>&imgURL=<urlencoded image-ref>"`, exits non-zero on empty hook or non-2xx.
  - `scripts/render-vercel-config.sh <api-origin> <out-file>` writes a copy of `apps/web/vercel.json` with the API host replaced in the `/api/:path*` rewrite and in the CSP `connect-src`, `media-src` and `wss:` entries. Exits non-zero if the output still contains the prod host.
  - Job `migrate`: `needs: build`, runs `pnpm --filter @learnquest/api db:migrate` with `DATABASE_URL` from the environment.
  - Job `deploy`: `needs: migrate`, `environment: staging`, `timeout-minutes: 20`. Refuses to deploy unless `github.sha` equals the current `origin/main` head (`git ls-remote`). Calls `render-deploy.sh` for api and engine. Then `pnpm install`, `render-vercel-config.sh` into `apps/web`, `npx vercel@<pinned> pull`, `build --prod`, `deploy --prebuilt --prod` against the staging project. Writes the deploy URL to a job output.
  - Job `smoke`: `needs: deploy`, `environment: staging`, `timeout-minutes: 10`, checkout, then `scripts/smoke.sh "$API_ORIGIN" "$WEB_ORIGIN" "$GITHUB_SHA"` with origins passed through `env:`.

- [ ] **Step 1: Write the failing tests**

- `render-deploy.test.sh`: empty hook → exit non-zero with a message; stub hook returns 200 → exit 0 and the stub logs a request whose query contains `imgURL=`.
- `render-vercel-config.test.sh`: given origin `https://lq-api-staging.onrender.com`, output contains the origin in rewrite and CSP, contains no `learnquest-api.onrender.com`, and is still valid JSON.
- Head-of-main check: a shell test stubs `git ls-remote` to return a different SHA and asserts the deploy guard exits non-zero.

- [ ] **Step 2: Run to verify they fail**

Run: `bash scripts/render-deploy.test.sh && bash scripts/render-vercel-config.test.sh`
Expected: FAIL, scripts not found.

- [ ] **Step 3: Implement the scripts and jobs**

Scripts per the Interfaces block. Workflow jobs per the Interfaces block. Use `env:` for every origin and secret before reference in `run:`. Pin `vercel` to an exact version. Smoke runs with `scripts/smoke.sh` from Task 2.

- [ ] **Step 4: Run to verify they pass**

Run: `bash scripts/render-deploy.test.sh && bash scripts/render-vercel-config.test.sh && bash scripts/smoke.test.sh && actionlint .github/workflows/deploy-staging.yml`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/ .github/workflows/deploy-staging.yml
git commit -m "ci(deploy): migrate, deploy and smoke staging per sha"
```

---

### Task 5: Docs and human setup

**Files:**
- Create: `docs/runbooks/staging-deploy.md`
- Modify: `docs/api-plan.md` (lines 218–222: one-line note that this story uses environment `staging` only; `production` comes with the prod WP)

**Interfaces:**
- Consumes: workflow and scripts from Tasks 1–4.
- Produces: runbook with one-time setup and rollback.

- [ ] **Step 1: Write the runbook**

Sections:
- GitHub Environment `staging`: secrets and vars from Task 4 Interfaces; deployment branch policy `main` only.
- Render: services `lq-api-staging` and `lq-engine-staging`, deploy hooks copied from each. The GHCR packages must be public, or Render given pull credentials. Image paths are lowercase.
- Vercel: a separate staging project (`learnquest-web-staging`) with its own env vars. Deployment Protection off for that project so smoke can reach it.
- Migrations: expand-only; run by the `migrate` job before the Render hook.
- Rollback: redeploy the previous SHA on Render, or promote the previous Vercel deployment. The deploy guard refuses old SHAs, so rollback is manual.
- Free tier sleeps: smoke budget covers cold start.

- [ ] **Step 2: Reconcile api-plan**

Add the one-line note to `docs/api-plan.md` lines 218–222.

- [ ] **Step 3: Verify**

Run: `pnpm exec prettier --check docs/runbooks/staging-deploy.md docs/api-plan.md`
Expected: no formatting errors (skip and say so if prettier is not configured).

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/staging-deploy.md docs/api-plan.md
git commit -m "docs(deploy): add staging runbook and env note"
```

WP13 in `docs/plan.md` is **not** marked done in this PR. It is a follow-up commit after the first green staging run on `main`.

---

## Decisions taken in this plan

1. **Staging web is a separate Vercel project, deployed with `--prod`.** Stable domain for the API origin check and the GitHub OAuth callback; no Deployment Protection on previews. Matches `docs/api-plan.md` D2.4.
2. **Migrations are included** as an expand-only `migrate` job. `readyz` only runs `SELECT 1`, so an unmigrated staging DB would otherwise pass smoke while broken.
3. **Smoke's protected-route check is `GET /api/trpc/home.get` → 401.** The `/api/lessons?world=codequest` route in `docs/api-plan.md` does not exist (lessons are tRPC, and the KidsQuest world was dropped in the pivot).
4. **The web origin is rewritten at build time in the CI working copy**, not committed, so production `vercel.json` never ships a placeholder.

## Human-only setup (outside the repo)

- Create GitHub Environment `staging` with its secrets, vars and branch policy.
- Create Render services `lq-api-staging` and `lq-engine-staging`; copy their deploy hooks.
- Create the Vercel project `learnquest-web-staging` and note its org and project IDs.

These are not done by an agent. The workflow fails clearly until they exist (Review Focus item 1).
