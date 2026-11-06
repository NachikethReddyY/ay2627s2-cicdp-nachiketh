# LearnSlop
LearnSlop turns a real code change into an adaptive lesson: the learner predicts the outcome before being told, and the system models what they understand and adapts the next step. This monorepo holds the Fastify + tRPC API (`apps/api`), the React/Vite web app (`apps/web`), the Python LLM engine (`services/engine`), and the shared `packages/player-core` and `packages/ui-catalog` packages. The product plan is in `docs/plan.md`.

## Local development

```bash
pnpm install

# Postgres 16. Compose refuses to start unless ENGINE_TOKEN is set (same value as services/engine/.env).
ENGINE_TOKEN=<token> docker compose up postgres

# Apply migrations (needs DATABASE_URL and BETTER_AUTH_SECRET, 32+ characters, in apps/api/.env)
pnpm --filter @learnquest/api db:migrate

# Start the API and web app
pnpm dev

# Lint, test and build everything. TEST_DATABASE_URL must point at a database whose name ends in _test
# (the API test helper refuses any other name). Default: postgres://learnquest:learnquest@localhost:5432/learnquest_test
TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test pnpm exec turbo run lint test build
```

## AI path builder (inference engine)

The "Learn anything" builder calls the Python engine in `services/engine`, which talks to any OpenAI-compatible model. Set `LLM_MODEL`, `LLM_API_BASE` and `LLM_API_KEY` in `services/engine/.env`, then:

```bash
cp services/engine/.env.example services/engine/.env
cd services/engine && uv run uvicorn learnquest_engine.server:app --reload
```

Set `ENGINE_URL` and `ENGINE_TOKEN` (the same token as the engine) in `apps/api/.env`. See [services/engine/README.md](services/engine/README.md).
