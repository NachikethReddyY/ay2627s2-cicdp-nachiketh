# LearnSlop
LearnSlop is an interactive tool for learning to program. Pick a concept or a real code change and it builds a short, adaptive lesson with diagrams, code replays, quizzes, games and practice. Learners predict the outcome before they see it, and the engine adapts the next step to what they understand. The target learners are beginner and early-career developers, starting with JavaScript and TypeScript.

The monorepo holds the Fastify + tRPC API (`apps/api`), the React/Vite web app (`apps/web`), the Python LLM engine (`services/engine`), the sandbox (`services/sandbox`), and the shared `packages/player-core` and `packages/ui-catalog` packages. The product direction is in [AGENTS.md](AGENTS.md). The detailed plan is in `docs/plan.md`.

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

## Rendering narration

`scripts/narrate.ts` renders one MP3 per lesson step from the step's `secret.narration` text. Run it on your own machine with your own keys. Keys come only from environment variables and are never printed or written to the repo.

```bash
# ElevenLabs (used when ELEVENLABS_API_KEY is set)
export ELEVENLABS_API_KEY=...        # required
export ELEVENLABS_VOICE_ID=...       # required
export ELEVENLABS_MODEL_ID=...       # optional, default eleven_multilingual_v2

# Or an OpenAI-compatible local server, such as Kokoro behind a wrapper (used when TTS_BASE_URL is set)
export TTS_BASE_URL=http://localhost:8880
export TTS_VOICE=...                 # required
export TTS_MODEL=...                 # optional, default tts-1

node scripts/narrate.ts --lesson <slug> --out "$PWD/.narration/<slug>" [--provider elevenlabs|openai] [--lesson-file <path>]
```

The script reads `worlds/codequest/lessons/<slug>.json` (or `--lesson-file`) and writes `<idx>.mp3` plus `narration.json` (a hash of each step's text) into `--out`. A rerun renders only steps whose text changed. Steps without narration are reported and get no file. The summary line shows how many steps were rendered, skipped, failed and left without narration. `.narration/` is gitignored.

Then store the files with the importer, using an absolute `--dir`:

```bash
pnpm --filter @learnquest/api media:narration --lesson <slug> --dir "$PWD/.narration/<slug>"
```

The importer skips steps that already have narration. Add `--replace` to swap the stored narration for those steps with the new files. The old row is marked `failed`, and its object stays in storage.

The script's tests run with `pnpm run test:scripts`.

## Lesson engine (inference engine)

The "Learn anything" builder calls the Python engine in `services/engine`, which talks to any OpenAI-compatible model. Set `LLM_MODEL`, `LLM_API_BASE` and `LLM_API_KEY` in `services/engine/.env`, then:

```bash
cp services/engine/.env.example services/engine/.env
cd services/engine && uv run uvicorn learnquest_engine.server:app --reload
```

Set `ENGINE_URL` and `ENGINE_TOKEN` (the same token as the engine) in `apps/api/.env`. See [services/engine/README.md](services/engine/README.md).

## End-to-end tests

`e2e/` has Playwright tests (Chromium) with axe accessibility checks. They run against the real compose stack: Postgres, the API and the engine. The engine's model calls go to `e2e/fake-llm`, which replays recorded replies from `services/engine/tests/fixtures`. No live model is called, and the engine cannot reach the internet.

```bash
pnpm --filter @learnquest/e2e run ci
```

The script brings up compose (`docker-compose.yml` with `docker-compose.ci.yml`), migrates and seeds the database, runs the tests, then tears the stack down with its volumes. It needs Docker, and ports 3000 (API) and 5173 (web, Vite preview) free. Postgres uses host port 55432 (`E2E_POSTGRES_PORT`). Failures print the last 200 lines of compose logs.
