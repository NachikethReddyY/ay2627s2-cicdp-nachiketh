# LearnQuest engine

The inference engine: the LLM pipelines behind "Learn anything" (path outline and lesson
generation). `learnquest_engine` is importable on its own; the FastAPI app is a thin layer on top.
It is stateless (JSON in, JSON out) and holds the only LLM key in the system.

Any OpenAI-compatible model works. Change three env vars, nothing in the code:

| Var | Example |
|---|---|
| `LLM_MODEL` | `openai/gpt-5.1-mini` (or `openai/<name>` for any OpenAI-compatible server) |
| `LLM_API_BASE` | `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `http://localhost:11434/v1` |
| `LLM_API_KEY` | your key (Ollama: any non-empty string) |

See `.env.example` for all settings, including `LLM_JSON_MODE` and `ENGINE_TOKEN`.

## Quick start

```bash
cp .env.example .env        # paste LLM_MODEL, LLM_API_BASE, LLM_API_KEY; set ENGINE_TOKEN (32+ chars)
uv sync
uv run uvicorn learnquest_engine.server:app --reload
```

Then set `ENGINE_URL=http://localhost:8000` and the same `ENGINE_TOKEN` in `apps/api/.env`, and run `pnpm dev`.

## API

- `POST /v1/pipeline/outline` `{topic}` → `{outline, usage, attempts}`
- `POST /v1/pipeline/lesson` `LessonContext` → `{lesson, usage, attempts}`
- `GET /healthz` → `{ok, model}` (no auth, no network call)

Both pipeline routes need `X-Engine-Token`. Errors: 422 `invalid_output` when the model output
fails validation after one repair retry; 502 `upstream` on provider failure; 401 on a bad token; 413 over 64 KB.

## Tests

```bash
uv run pytest          # offline: sockets are blocked, LLM replies come from tests/fixtures
uv run ruff check learnquest_engine tests scripts
uv run mypy --strict learnquest_engine
```

Fixtures are replayed, never fetched. To record a new one with a real key, run by hand (never in CI):

```bash
uv run python scripts/record.py --kind lesson --input ctx.json --out tests/fixtures/lesson_x.json
```

## Pinned dependency

`litellm==1.106.2` is pinned and hash-locked in `uv.lock`. Versions 1.107.0, 1.82.7 and 1.82.8 were
compromised; see `spikes/litellm-advisory/README.md`. Re-run `spikes/litellm-advisory/check.py` before any bump.
