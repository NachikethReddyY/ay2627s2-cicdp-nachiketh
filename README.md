# LearnQuest

A learning app with lessons generated for each learner, including an AI "Learn anything" path builder.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | React + Vite frontend, deployed on Vercel |
| `apps/api` | Fastify + tRPC API with Better Auth and Postgres (Drizzle), deployed on Render |
| `services/engine` | Python FastAPI inference engine: the LLM pipelines behind "Learn anything" |
| `services/sandbox` | Image for the per-learner Docker shell (optional, off by default) |
| `packages/player-core`, `packages/ui-catalog` | Shared lesson player and the UI block catalog with its checker |
| `docs` | Plans, ADRs and the references below |

## Documentation

- [Configuration reference](docs/configuration.md): every environment variable, and which model does what
- [Deployment](docs/deployment.md): architecture, Render/Vercel/Neon/R2 setup, keep-alive, troubleshooting
- [Engine README](services/engine/README.md): running and testing the inference engine
- [ADRs](docs/adr) and [plans](docs/plans): design decisions and feature plans (some predate the current code)

## Quick start

Requires Node 22+, pnpm, Docker (for Postgres) and, for the engine, `uv`.

```bash
pnpm install
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
cp services/engine/.env.example services/engine/.env   # set LLM_MODEL, LLM_API_BASE, LLM_API_KEY, ENGINE_TOKEN
pnpm --filter @learnquest/api db:migrate && pnpm --filter @learnquest/api db:seed
pnpm dev
```

Run the engine alongside it for AI paths:

```bash
cd services/engine && uv sync && uv run uvicorn learnquest_engine.server:app --reload
```

then set `ENGINE_URL=http://localhost:8000` and the same `ENGINE_TOKEN` in `apps/api/.env`.

## Checks

```bash
pnpm exec turbo run lint test build     # needs TEST_DATABASE_URL, see .github/workflows/ci.yml
cd services/engine && uv run pytest && uv run ruff check learnquest_engine tests scripts && uv run mypy --strict learnquest_engine
```
