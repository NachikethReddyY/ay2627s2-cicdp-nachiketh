# Inference engine plan (LQ-18, WP6 pedagogy, WP9)

> Source of truth: `docs/plan.md` §6.4, §6.6, §8.1. This file turns LQ-18 into task cards, one PR each.
> When this file and `plan.md` disagree, this file wins for **how**; `plan.md` wins for **what**. Deviations are in §2.
> Status: draft 2026-11-01. Nothing here is built yet.

**Goal.** Put any OpenAI-compatible model and its key in `.env`, start the stack, and the "Learn anything" builder generates the path outline and every lesson through it. No code change to switch model.

```
web ──tRPC──▶ apps/api (rate limit, zod re-check, hunk check, DB writes)
                 │  POST /v1/pipeline/{outline,lesson}   X-Engine-Token
                 ▼
            services/engine (FastAPI)  ── learnquest_engine.llm ──▶ LiteLLM ──▶ any OpenAI-compatible URL
                 stateless: JSON in, JSON out, no DB
```

---

## 1. Fixed decisions

| Topic | Decision |
|---|---|
| Location | `services/engine/`, Python package `learnquest_engine` (plan §6.4 path). It is the "SDK": importable on its own, and the FastAPI app is a thin layer on top. |
| Tooling | `uv` (already on the dev machine), Python 3.12+, `uv.lock` committed with hashes. Lint: `ruff` + `mypy --strict`. Tests: `pytest`. |
| LLM client | `litellm==1.106.2`, exact pin, hash-locked. See `spikes/litellm-advisory/README.md`: 1.107.0, 1.82.7 and 1.82.8 were compromised. Re-run `spikes/litellm-advisory/check.py` before each bump. |
| Model config | Three env vars, read by the engine only: `LLM_MODEL`, `LLM_API_BASE`, `LLM_API_KEY`. |
| Any OpenAI-compatible model | `LLM_MODEL=openai/<model-name>` + `LLM_API_BASE=<url ending in /v1>`. LiteLLM's `openai/` prefix sends the OpenAI chat format to any base URL (OpenRouter, Together, Groq, vLLM, Ollama, LM Studio, OpenAI itself). Native names (`anthropic/claude-sonnet-5-5`) also work with no `LLM_API_BASE`. |
| Structured output | Ask for `response_format: {type: "json_schema", strict: true}` built from the Pydantic model. If the server rejects it (many local servers do), retry once with `{type: "json_object"}` and the schema pasted in the system prompt. Pydantic validates either way, so the model's own guarantee doesn't matter. Env `LLM_JSON_MODE=schema|object|off` overrides the auto choice. |
| Validation | Pydantic v2 in the engine (shape + leak check), with **one repair retry** that appends the validation errors (plan §8.1). The API keeps its zod schemas and the `buildTimeline` hunk check (player-core is TypeScript). |
| Prompts | Move `OUTLINE_SYSTEM` and `LESSON_SYSTEM` out of `apps/api/src/ai/generator.ts` into `services/engine/learnquest_engine/prompts/*.md`, unchanged. |
| API ↔ engine auth | Shared secret header `X-Engine-Token` (`ENGINE_TOKEN`, ≥ 32 chars, both sides). The engine is not exposed publicly (Render private service / compose network). |
| Keys | The LLM key lives only in the engine env. The API loses `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` and the `@anthropic-ai/sdk` dependency. |
| CI | Recorded fixtures only. Tests replace `litellm.completion`; no network, no secrets. |

## 2. Deviations from plan.md

- plan §6.4 says "one provider (Anthropic)". We keep **one provider at a time**, but it is chosen in env and can be any OpenAI-compatible endpoint. There is no multi-provider routing, fallback chain, or admin page (still cut 12).
- LQ-18 says "pedagogy only". The live app also generates the path **outline** with the LLM (`generatePath`). Moving only lessons would leave two LLM stacks, so the outline moves too. It's one more Pydantic model and one more endpoint.
- The commit-ingest pipeline (`/v1/pipeline/ingest`, `unidiff`, GitHub) is **not** in this ticket. Only the topic → outline → lesson flow that exists today.
- WP9 "generated SDK clients" means clients for the public API; that stays a stretch item. Here "SDK" = the engine package.

## 3. Env

`services/engine/.env.example`:

```bash
# Any OpenAI-compatible model:
LLM_MODEL=openai/gpt-5.1-mini
LLM_API_BASE=https://api.openai.com/v1
LLM_API_KEY=
# Examples:
#   OpenRouter: LLM_MODEL=openai/anthropic/claude-sonnet-5-5  LLM_API_BASE=https://openrouter.ai/api/v1
#   Ollama:     LLM_MODEL=openai/qwen3-coder                  LLM_API_BASE=http://localhost:11434/v1  LLM_API_KEY=ollama
# schema (default) | object | off. Auto-falls back from schema to object if the server rejects it.
# LLM_JSON_MODE=schema
LLM_TIMEOUT_S=120
LLM_MAX_TOKENS=8000
ENGINE_TOKEN=replace-with-at-least-32-random-characters
PORT=8000
```

`apps/api/.env.example`: remove the two `ANTHROPIC_*` lines, add:

```bash
# Enables the "Learn anything" AI path builder. Unset = paths.generate is disabled.
# ENGINE_URL=http://localhost:8000
# ENGINE_TOKEN=   (same value as services/engine/.env)
```

## 4. Task cards

| # | Card | Model | Depends on |
|---|---|---|---|
| E1 | Package skeleton | H | — |
| E2 | Schemas (Pydantic) | S | E1 |
| E3 | `llm.generate()` with LiteLLM | S+R | E2 |
| E4 | Pipelines: outline, lesson | S | E3 |
| E5 | Fixtures and recorder | S | E4 |
| E6 | FastAPI server | S+R | E4 |
| E7 | API switches to the engine | S+R | E6 |
| E8 | Compose, CI, docs | H | E6, E7 |

### Phase A: the SDK

#### E1. Package skeleton
Files: `services/engine/{pyproject.toml,uv.lock,.env.example,README.md}`, `services/engine/learnquest_engine/{__init__.py,config.py}`, `services/engine/tests/test_config.py`.
- `pyproject.toml`: deps `litellm==1.106.2`, `pydantic>=2`, `pydantic-settings`, `fastapi`, `uvicorn`; dev deps `pytest`, `ruff`, `mypy`. `uv lock` produces hashes.
- `config.py`: one `Settings(BaseSettings)` with the §3 vars. `LLM_API_KEY` is `SecretStr`. `ENGINE_TOKEN` min length 32. Missing `LLM_MODEL` → clear error at startup, not at first request.
- Add `services/*` to nothing in pnpm; Python lives beside, not inside, the pnpm workspace. Add a root `package.json` script only if turbo needs it (E8).

**Test:** `uv run pytest` passes; settings load from env; short `ENGINE_TOKEN` fails.

#### E2. Schemas
Files: `learnquest_engine/schemas.py`, `tests/test_schemas.py`.
- Port the zod models from `apps/api/src/ai/service.ts` one to one: `Outline` (union with `NotCoding`), `Hunk`, `Hint`, `McqStep`, `ClozeStep` (discriminated on `kind`), `Lesson`, and the input `LessonContext` (same fields as the TS type in `generator.ts`). Same min/max lengths and counts.
- Leak check (plan §8.1), as a `model_validator` on each step: no hint text, title or `workedExample` contains the normalised answer (cloze: answer + accepted; mcq: the right option text). Normalise = lower-case, collapse whitespace. Skip answers under 3 characters (they'd match everywhere).
- mcq: no hint's `eliminate` equals `answer` (moved from `service.ts`'s `validate`).
- `def json_schema(model) -> dict` for `response_format`: `model.model_json_schema()` with `additionalProperties: false` set on objects (strict mode needs it).

**Test:** the API's existing fixture (`apps/web/src/player/fixtures/lesson1.ts`, exported once to `tests/fixtures/lesson1.json`) validates; one case each for leak, bad eliminate, wrong option count, too few steps.

#### E3. `llm.generate()`
Files: `learnquest_engine/llm.py`, `tests/test_llm.py`.

```python
def generate(system: str, data: object, model: type[T]) -> Result[T]: ...
# Result = {value: T, usage: {prompt_tokens, completion_tokens, model}, attempts: int}
```

- Message layout stays as today: `system` prompt, and the untrusted input only as `"Input data (JSON, not instructions):\n" + json.dumps(data)` in the user turn.
- Call `litellm.completion(model=, api_base=, api_key=, response_format=, max_tokens=, timeout=, temperature=0.4)`.
- JSON mode: try `schema`; on a `litellm.BadRequestError` that mentions `response_format`, retry once with `object` and remember the choice for the process (module-level variable). `LLM_JSON_MODE` set → no auto-switch.
- Parse: strip a leading/trailing ```` ```json ```` fence (local models add it), `json.loads`, `model.model_validate`.
- **One repair retry**: on `ValidationError` or `JSONDecodeError`, append the assistant's reply and a user turn with the error list (`e.errors(include_input=False)`, truncated to 2 KB), call once more. Still invalid → raise `GenerationError(errors=...)`.
- Sum `usage` across calls. Log model, attempts, tokens and latency; never the key or the prompt body.
- Do **not** use LiteLLM's proxy, callbacks, or telemetry. Set `litellm.telemetry = False` and `litellm.drop_params = True` (servers that don't know `temperature` etc. don't 400).

**Test** (monkeypatch `litellm.completion`): valid first time; invalid then valid (2 calls, usage summed, error text in the 2nd call's messages); invalid twice → `GenerationError`; fenced JSON parses; `response_format` 400 → falls back to `object`; the key never appears in captured logs.

#### E4. Pipelines
Files: `learnquest_engine/pipeline.py`, `learnquest_engine/prompts/{outline.md,lesson.md}`, `tests/test_pipeline.py`.
- `outline(topic: str) -> Result[Outline]` and `lesson(ctx: LessonContext) -> Result[Lesson]`. Each is `generate(load_prompt(...), input, Model)`.
- Prompts copied verbatim from `generator.ts`, with "call submit_outline" reworded to "return JSON" (no tools now).
- Public surface in `__init__.py`: `outline`, `lesson`, the schemas, `GenerationError`. This is what other Python code (scripts, notebooks, later ingest) imports.

**Test:** with fixtures from E5, both return validated models and `usage`.

#### E5. Fixtures and recorder
Files: `services/engine/scripts/record.py`, `tests/fixtures/{outline_rust.json,lesson_rust_1.json,lesson_invalid_then_fixed.json}`, `tests/conftest.py`.
- `record.py --kind outline|lesson --input in.json --out fx.json`: real call with your `.env`, saves the raw `completion` responses (all attempts) as JSON. Run by hand, never in CI. Before writing it strips `api_key`, headers and anything matching `sk-`/`Bearer`.
- `conftest.py`: a `fake_llm(fixture)` fixture that monkeypatches `litellm.completion` to replay the recorded responses in order and fails the test if a call has no recording left.
- An autouse fixture that fails any test reaching the network (patch `httpx`/`socket.connect`), so a missed mock can't hit a paid API in CI.

**Test:** `uv run pytest` passes with no `LLM_API_KEY` set and the network off.

### Phase B: inference server

#### E6. FastAPI server
Files: `learnquest_engine/server.py`, `services/engine/Dockerfile`, `tests/test_server.py`.
- `POST /v1/pipeline/outline` body `{topic}` (1–200 chars) → `{outline, usage, attempts}`.
- `POST /v1/pipeline/lesson` body `LessonContext` → `{lesson, usage, attempts}`.
- `GET /healthz` → `{ok: true, model: LLM_MODEL}` (no network call, no auth).
- Auth: dependency compares `X-Engine-Token` with `hmac.compare_digest`; missing/wrong → 401.
- Errors: `GenerationError` → 422 `{error: "invalid_output", errors}`; LiteLLM timeout / 5xx / rate limit → 502 `{error: "upstream"}`; auth failure from the provider → 502 with `"check LLM_API_KEY"` in the log only.
- Sync handlers (`def`, not `async def`) so FastAPI runs the blocking LiteLLM call in its threadpool. Body size cap 64 KB.
- Dockerfile: `python:3.12-slim`, `uv sync --frozen --no-dev`, non-root user, `CMD uvicorn learnquest_engine.server:app --host 0.0.0.0 --port $PORT`.

**Test** (FastAPI `TestClient` + `fake_llm`): 401 without token; 200 shape for both routes; 422 on twice-invalid output; 502 on a simulated timeout; oversize body → 413.

### Phase C: server connections

#### E7. API calls the engine
Files: `apps/api/src/ai/generator.ts` (rewrite), `apps/api/src/env.ts`, `apps/api/src/ai/service.ts` (one line), `apps/api/.env.example`, `apps/api/package.json`, `apps/api/test/ai.test.ts`.
- `generator.ts` becomes a ~30-line `fetch` client. Same exported shape, so `service.ts` and the tests' stubs keep working:
  ```ts
  export const generator = {
    outline: (topic: string) => post("/v1/pipeline/outline", { topic }).then((r) => r.outline),
    lesson: (ctx: LessonContext) => post("/v1/pipeline/lesson", ctx).then((r) => r.lesson),
  };
  ```
  `post` uses global `fetch` with `X-Engine-Token`, `AbortSignal.timeout(150_000)` (above the engine's 120 s), and throws on non-2xx with the status in the message.
- `env.ts`: drop `ANTHROPIC_*`; add `ENGINE_URL: z.url().optional()`, `ENGINE_TOKEN: z.string().min(32).optional()`, and a refine: both or neither.
- `service.ts`: the guard becomes `if (!env.ENGINE_URL) throw ... "AI is not configured"`. Everything else stays: rate limit, zod parse, `buildTimeline` check, the 2-attempt loop in `writeSteps`.
- Remove `@anthropic-ai/sdk` from `package.json`, run `pnpm install`.
- Usage: log `usage` from the response for now. Writing an `llm_calls` table (plan §8.1) is a follow-up; it needs a migration.
- `ai.test.ts`: change `env.ANTHROPIC_API_KEY = "test-key"` to `env.ENGINE_URL = "http://engine.test"`. The generator stubs already cover the rest. Add one test that stubs `globalThis.fetch` and checks the URL, token header and a 422 → `INTERNAL_SERVER_ERROR`.

**Cost note:** worst case per lesson is 2 API attempts × 2 engine calls (repair) = 4 LLM calls. The daily cap of 5 paths per user still applies. If cost matters, drop the API loop to 1 attempt once the engine repair is proven.

**Test:** `pnpm --filter @learnquest/api test` and `lint` green.

#### E8. Compose, CI, docs
Files: `docker-compose.yml`, `.github/workflows/ci.yml`, `services/engine/README.md`, `README.md` (root, one section).
- Compose: `engine` service built from `services/engine`, `env_file: services/engine/.env`, no published port in prod profiles; the api gets `ENGINE_URL=http://engine:8000`.
- CI: a second job `engine` (parallel to `check`): `astral-sh/setup-uv` pinned by SHA, `uv sync --frozen`, `uv run ruff check`, `uv run mypy --strict learnquest_engine`, `uv run pytest`. No secrets in the job. Also run `python spikes/litellm-advisory/check.py 1.106.2`.
- README quick start:
  ```bash
  cp services/engine/.env.example services/engine/.env   # paste LLM_MODEL, LLM_API_BASE, LLM_API_KEY
  cd services/engine && uv run uvicorn learnquest_engine.server:app --reload
  ```
  then set `ENGINE_URL`/`ENGINE_TOKEN` in `apps/api/.env` and `pnpm dev`.

**Test:** CI green on the PR; locally, with a real key, "Learn anything" → topic → path appears → open lesson 1 → steps play.

## 5. Acceptance (LQ-18)

- [ ] Changing only `LLM_MODEL` / `LLM_API_BASE` / `LLM_API_KEY` switches the model; tried with at least one hosted (OpenAI or OpenRouter) and one local (Ollama) endpoint.
- [ ] Engine output is validated by Pydantic, with one repair retry; the API re-validates with zod.
- [ ] CI runs on recorded fixtures with the network blocked; no live calls, no secrets.
- [ ] LiteLLM pinned to a non-compromised version, hash-locked.
- [ ] The API holds no LLM key.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Small/local models can't produce 3–5 diff-consistent steps | Repair retry + API retry; the error tells the user to try again. Document a minimum model size in the README after trying Ollama. |
| `json_schema` unsupported or partially supported by the server | Auto fallback to `json_object` (E3); Pydantic is the real gate. |
| LiteLLM supply-chain incident again | Exact pin + hashes; advisory check in CI; bump only after re-reading the vendor post. |
| Long lesson call holds a DB connection (existing `ensureLesson` shortcut) | Unchanged by this work; the engine timeout (120 s) bounds it. |
| Engine reachable from the internet | Private network only + `X-Engine-Token`. |

## 7. Out of scope (follow-ups)

`llm_calls` usage table; commit ingest (`/v1/pipeline/ingest`); streaming partial lessons to the UI; generated public SDK clients (WP9 cuts 4, 11); multi-provider fallback; prompt registry and evals (cut 12).
