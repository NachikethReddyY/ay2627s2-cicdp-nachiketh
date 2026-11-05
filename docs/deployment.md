# Deployment

```text
Browser ──> Vercel (apps/web, static + rewrites)
              │  /api/*
              ▼
            Render: learnquest-api (apps/api, Fastify + tRPC)
              │         │              │
              │         │              └──> Cloudflare R2   (narration, images)
              │         └──> Neon Postgres
              ▼
            Render: learnquest-engine (services/engine, FastAPI + LiteLLM)
              └──> thinking model (OpenAI-compatible: NVIDIA, OpenRouter, TokenRouter, ...)
```

The API also calls the image model and OpenAI's moderation endpoint directly. See
[configuration.md](configuration.md) for every variable and which model each one drives.

## Services

| Service | Host | Build | Health check |
|---|---|---|---|
| Web | Vercel | `apps/web` (Vite) | n/a |
| API | Render web service | Docker, [`infra/docker/api.Dockerfile`](../infra/docker/api.Dockerfile), repo root context | `/api/healthz` (liveness), `/api/readyz` (also runs `SELECT 1`) |
| Engine | Render web service | Docker, [`services/engine/Dockerfile`](../services/engine/Dockerfile), **repo root context** | `/healthz` |
| Database | Neon | managed | n/a |
| Media | Cloudflare R2 | managed | n/a |

Both Dockerfiles build from the repository root because they use the pnpm workspace and
`packages/ui-catalog`. In Render set Dockerfile Path explicitly and leave Root Directory empty.

The API image compiles `node-pty` from source because it has no Linux prebuilt binaries; that is why the
first build stage installs `python3 make g++`.

## First-time setup

1. **Neon**: create a project and copy the connection string. The server does not migrate on boot. From your
   machine, with `DATABASE_URL` pointing at Neon, run `pnpm --filter @learnquest/api db:migrate`, then
   `db:seed` for the starter worlds. Re-run `db:migrate` whenever a change adds a migration under `apps/api/drizzle`.
2. **Engine on Render**: create a web service from `services/engine/Dockerfile`. Set `LLM_MODEL`,
   `LLM_API_BASE`, `LLM_API_KEY` and a fresh `ENGINE_TOKEN`. Set the health check path to `/healthz`.
3. **API on Render**: create a web service from `infra/docker/api.Dockerfile`. Set the variables from
   [configuration.md](configuration.md). `ENGINE_URL` is the engine's public `onrender.com` URL, and
   `ENGINE_TOKEN` must match. Set the health check path to `/api/healthz`.
4. **Vercel**: deploy `apps/web`. Make sure the rewrite and CSP in `vercel.json` point at the API's Render URL.
5. Set `PUBLIC_ORIGIN` on the API to the Vercel URL **exactly**, then redeploy.
6. Check `GET <api>/api/readyz` returns 200.

Render lets you paste or drag a `.env` file into the Environment tab (Add from .env). Keep such files out of
git; `.env.render` is gitignored for that purpose.

## Free tier: keeping services warm

Render free web services sleep after about 15 minutes without inbound traffic, and the next request waits
roughly 30 to 60 seconds. The first request during a wake-up can return 503.

Use an external monitor (cron-job.org or UptimeRobot) on a 5 to 10 minute interval:

- `GET https://<api>.onrender.com/api/healthz`
- `GET https://<engine>.onrender.com/healthz`

Set the request timeout above 60 seconds so a cold start is not counted as a failure. Do not ping `/api/readyz`
on a short interval: it queries Neon and keeps the database awake, which burns compute hours.

One always-on free service uses about 720 of the 750 monthly free instance hours. Two do not fit in one
Render workspace; plan for the engine to sleep, or move it to a paid instance.

## Rolling out a change

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs lint, test and build for the monorepo and
the engine's pytest, ruff and mypy. Deploys are not part of CI: they depend on the auto-deploy setting of each Render and Vercel service
(on by default when connected to the repo's `main`). After a deploy, check `/api/readyz`. If it fails with a connection error, look at the database URL first (see below).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| API exits at boot with `env X: ...` | A required variable is missing, or an optional one is set to an empty string. Comment it out. |
| `env S3_BUCKET: set all of ...` | Only some of the four `S3_*` variables are set. |
| 503 on the first request after idle | Cold start. Use the keep-alive above. |
| `readyz` is 503 | Database unreachable. Check `DATABASE_URL`; if the driver rejects it, drop `channel_binding=require` and keep `sslmode=require`. |
| "AI is not configured" | Neither `ANTHROPIC_API_KEY` nor `ENGINE_TOKEN` is set on the API. |
| `502 Engine unreachable` | Wrong `ENGINE_URL`, or the engine is asleep. |
| `401` from the engine | `ENGINE_TOKEN` differs between the two services. |
| Lessons show text instead of pictures | Image variables incomplete, `MODERATION_API_KEY` missing, or the daily image cap is reached. |
| Narration or media calls answer `PRECONDITION_FAILED` | The `S3_*` variables are not set. |
| Predict-style lessons fail | `ANTHROPIC_API_KEY` is not set; that path has no engine fallback. |
