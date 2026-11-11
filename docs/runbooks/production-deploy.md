# Production deploy

The workflow `.github/workflows/deploy-production.yml` deploys after CI succeeds for a `main` commit. Order: build the API and engine images once per SHA (GHCR), migrate the production database, deploy both images on Render, deploy the web app to the production Vercel project, then smoke. A run is green only when smoke passes against the SHA it deployed.

## One-time setup (by hand)

These steps are outside the repo. The workflow fails clearly until they are done.

### GitHub

1. **Environment `production`** (Settings → Environments → New environment).
2. **Deployment branch policy:** allow `main` only.
3. **Secrets** (environment level, not repository level):
   - `DATABASE_URL`: the production Postgres connection string (Neon production branch, **direct host, not the `-pooler` one**). Migrations need a session connection; a transaction pooler can misbehave with them.
   - `RENDER_DEPLOY_HOOK_API`: deploy hook URL of `learnquest-api`.
   - `RENDER_DEPLOY_HOOK_ENGINE`: deploy hook URL of `learnquest-engine`.
   - `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`: for the production Vercel project.
4. **Variables** (environment level):
   - `API_ORIGIN`: `https://learnquest-api.onrender.com` (no path, no trailing slash).
   - `ENGINE_ORIGIN`: the production Engine Render URL (no path or trailing slash).
   - `WEB_ORIGIN`: the production Vercel alias, for example `https://pip-learnquest.vercel.app`.
5. **Packages:** the GHCR packages `learnquest-api` and `learnquest-engine` must be readable by Render. Make them public, or give Render registry credentials.

### Render

1. Create Web Services `learnquest-api` and `learnquest-engine`, type "Existing image". Set the image later through the deploy hook, not in the dashboard.
2. API: health check path `/api/healthz`. Set `NODE_ENV=production`, `WORKER_IN_PROCESS=true`, `PUBLIC_ORIGIN` = the Vercel production URL, and the other variables listed in `apps/api/.env.example`.
3. Engine: health check path `/healthz`. Set `LLM_*`, `ENGINE_TOKEN` and `PORT` from `services/engine/.env.example`.
4. Copy each service's **deploy hook URL** into the matching GitHub secret. The hook URL is a secret; never paste it into a chat or a log.

### Vercel

1. Use the production Vercel project (`pip-learnquest`) with root directory `apps/web`.
2. Ensure the production alias in `WEB_ORIGIN` is publicly reachable by the smoke checks.
3. Add a **Production** environment variable `VITE_SHELL_WS_ORIGIN=wss://learnquest-api.onrender.com` (the API's `wss://` origin, no path). The terminal opens its WebSocket straight to the API, and Vercel cannot forward WebSockets, so without this the terminal fails on production. `vercel pull --environment=production` writes it into the build. Changing `vercel.json` does not set it.
4. Copy the token, org ID and project ID into the GitHub secrets above.

## What a run does

1. `build`: builds `ghcr.io/<owner>/learnquest-api:<sha>` and `…/learnquest-engine:<sha>`. An image that already exists for the SHA is reused, so a rerun does not rebuild.
2. `migrate`: runs `db:migrate` against production. Migrations must be expand-only, so the previous SHA keeps working until it is replaced.
3. `deploy`: refuses any SHA that is not the head of `main`, then calls both Render hooks with `imgURL`, then builds the web app with the production API origin written into a CI-only copy of `vercel.json`, then deploys it with `--prod` to the production project.
4. `smoke`: waits for the API and the engine to report the new SHA (`/api/healthz` and `/healthz`), then checks `/api/readyz`, the auth gate on `/api/trpc/home.get` (401 expected), and the web origin's `/` and `/api` rewrite.

If smoke times out with a stale SHA, Render has not finished rolling out. Check the Render deploy log before rerunning.

## Rollback

The workflow refuses to deploy an older SHA, so rollback is manual:

- **API and engine:** from a terminal, call the hook with the previous image. Replace `<hook>` and `<old-sha>`:
  `curl -fsS -X POST -G --data-urlencode "imgURL=ghcr.io/<owner>/learnquest-api:<old-sha>" "<hook>"`.
  The engine uses `learnquest-engine` instead. The old image must still exist in GHCR.
- **Web:** in the Vercel dashboard, open the previous production deployment of `pip-learnquest` and promote it.

## Known gaps

- - Free-tier Render services sleep. The smoke budget (default 300 s) covers the cold start, but the first deploy after a long idle can still be slow.
- The web build depends on the Vercel project root directory setting (`apps/web`) and on `pnpm install` in CI. Both are verified only by a real run.
