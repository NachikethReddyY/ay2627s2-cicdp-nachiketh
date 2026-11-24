# LearnSlop
LearnSlop teaches beginners and early-career developers aged 13 and over to read and write code. Pick a JavaScript or TypeScript concept to generate a private path. Start with a short explanation, trace a worked example in a narrated Scrim, practice in the Workbench, and check what you learned on fresh code. LearnSlop uses concept mastery to suggest what to study or review next. Sloppy offers hints and prediction questions in the Workbench. An advanced track for real code changes is planned.

The monorepo holds the Fastify + tRPC API (`apps/api`), the React/Vite web app (`apps/web`), the Python LLM engine (`services/engine`), the sandbox (`services/sandbox`), and the shared `packages/player-core` and `packages/ui-catalog` packages. See the [feature map](docs/feature-map.md), [project plan](docs/plan.md) and [agent instructions](AGENTS.md).

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

node scripts/narrate.ts --lesson <slug> [--provider elevenlabs|openai]
```

`--lesson` is required and must be lowercase letters, digits and hyphens. The script reads `worlds/codequest/lessons/<slug>.json` and writes `<idx>.mp3` plus `narration.json` (a hash of each step's text) to `.narration/<slug>/` under the repo root. That folder is gitignored, and there is no option to write anywhere else. To use the files elsewhere, copy the folder. A rerun renders only steps whose text changed. Audio for steps removed from the lesson is deleted. A step's old audio is removed before it is rendered, and the manifest is updated after each step, so an interrupted run never leaves audio that a rerun would skip. Each provider request, including reading its body, times out after 120 seconds and counts as a failed step. A run takes a lock file (`.narration.lock`) in the output folder, so two runs cannot write the same folder. A lock left by a killed run is taken over automatically. Each MP3 must have an MP3 signature and be at most 10 MiB, or the step fails and is not cached. Steps without narration are reported and get no file. The summary line shows how many steps were rendered, skipped, failed and left without narration.

Then store the files with the importer, using an absolute `--dir`:

```bash
pnpm --filter @learnquest/api media:narration --lesson <slug> --dir "$PWD/.narration/<slug>"
```

The importer skips steps that already have narration. Add `--replace` to swap the stored narration for those steps with the new files. The new file is validated and stored first. Only then is the old row marked `failed` and the new row inserted, in one transaction, so a rejected file leaves the old narration in place. The old object stays in storage.

The script's tests run with `pnpm run test:scripts`.

## Lesson engine (inference engine)

The "Learn a programming concept" builder calls the Python engine in `services/engine`, which talks to any OpenAI-compatible model. Set `LLM_MODEL`, `LLM_API_BASE` and `LLM_API_KEY` in `services/engine/.env`, then:

```bash
cp services/engine/.env.example services/engine/.env
cd services/engine && uv run uvicorn learnquest_engine.server:app --reload
```

Set `ENGINE_URL` and `ENGINE_TOKEN` (the same token as the engine) in `apps/api/.env`. See [services/engine/README.md](services/engine/README.md).

## Seeding lesson content

Run `pnpm --filter @learnquest/api db:seed` to load the authored worlds. Reseeding restores authored lesson statuses and updates their steps. Retired steps with learner history are archived. With local object storage configured, pass `--narration` to also seed placeholder scrim audio.

## End-to-end tests

`e2e/` has Playwright tests (Chromium) with axe accessibility checks. They run against the real compose stack: Postgres, the API and the engine. The engine's model calls go to `e2e/fake-llm`, which replays recorded replies from `services/engine/tests/fixtures`. No live model is called, and the engine cannot reach the internet.

```bash
pnpm --filter @learnquest/e2e run ci
```

The script brings up compose (`docker-compose.yml` with `docker-compose.ci.yml`), migrates and seeds the database, runs the tests, then tears the stack down with its volumes. It needs Docker. Override `E2E_API_PORT`, `E2E_WEB_PORT` and `E2E_POSTGRES_PORT` if the defaults of 3000, 5173 and 55432 are in use. Set `E2E_COMPOSE_PROJECT` for a separate Compose project when running suites in parallel. Failures print the last 200 lines of compose logs.
