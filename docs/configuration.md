# Configuration reference

Every environment variable the system reads, by service. The source of truth is
[`apps/api/src/env.ts`](../apps/api/src/env.ts) (validated with zod at boot) and
[`services/engine/learnquest_engine/config.py`](../services/engine/learnquest_engine/config.py)
(pydantic-settings). A bad or **blank** value for a validated key stops the process at startup
with `env <KEY>: <reason>`, so comment a variable out rather than leaving it empty.

## Which model does what

| Job | Where it runs | Variables | Provider |
|---|---|---|---|
| Thinking: path outlines, lesson parts (the main generation) | Engine (Python, LiteLLM) | `LLM_MODEL`, `LLM_API_BASE`, `LLM_API_KEY` | Any OpenAI-compatible endpoint (NVIDIA NIM, OpenRouter, TokenRouter, OpenAI, Ollama) |
| Images | API | `IMAGE_BASE_URL`, `IMAGE_API_KEY`, `IMAGE_MODEL`, `IMAGE_API_STYLE` | Any OpenAI-compatible image endpoint |
| Moderation | API | `MODERATION_API_KEY` | **OpenAI only**: the URL is hardcoded to `api.openai.com/v1/moderations` |
| Predict-style lessons | API | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic only (no engine fallback yet) |
| Narration and media storage | API | `S3_*` | Cloudflare R2 (any S3-compatible store) |

Routing rules worth knowing:

- **Outlines** (`paths.generate`) use Anthropic when `ANTHROPIC_API_KEY` is set, otherwise the engine.
  With no Anthropic key, the engine is mandatory, so `ENGINE_URL` and `ENGINE_TOKEN` must be set.
- **Lesson parts** (cached, non-predict kinds) always go through the engine.
- **Predict-style lessons** call Anthropic directly in `apps/api/src/ai/generator.ts` (`generator.lesson`).
  Without `ANTHROPIC_API_KEY` that path fails. Routing it through the engine is the missing piece
  for running with no Anthropic key at all.
- **Moderation** fails open for text (topics, generated lessons) and fails **closed** for images. With no
  `MODERATION_API_KEY`, text passes unchecked and image generation is effectively off.
- **Images** need all of `IMAGE_BASE_URL`, `IMAGE_API_KEY`, `IMAGE_MODEL`. Otherwise the lesson shows the
  text description as a marked fallback.

## API (`apps/api`)

### Required

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string. On Neon, the pooled (`-pooler`) host is fine. |
| `BETTER_AUTH_SECRET` | 32+ characters. Rotating it signs every user out. |
| `NODE_ENV` | `development` (default), `test`, `production`. Set `production` when deployed. The dev-only `/api/dev/*` routes exist only in development and test. |
| `PUBLIC_ORIGIN` | The frontend's exact origin, no trailing slash. Used for CORS and as the auth base URL. |

### Database and server

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL_UNPOOLED` | none | If set, **replaces** `DATABASE_URL` at runtime. Use Neon's direct string here and the pooled one in `DATABASE_URL` if you want both. |
| `BETTER_AUTH_URL` | `PUBLIC_ORIGIN` | Override only if the API's public URL differs. |
| `PORT` | `3000` | Render injects this; do not set it there. |
| `TRUSTED_PROXY` | none | IP or CIDRs of the reverse proxy so per-IP rate limits see real clients. Unset trusts no forwarded address. |

### Engine

| Variable | Default | Notes |
|---|---|---|
| `ENGINE_URL` | `http://localhost:8000` | Base URL of the engine service. |
| `ENGINE_TOKEN` | none | 32+ characters; must equal the engine's `ENGINE_TOKEN`. Sent as `X-Engine-Token`. |
| `ENGINE_TIMEOUT_MS` | `400000` | A lesson's visual pass can make up to three model calls. |

### AI, images, budgets

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Optional; see routing rules above. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | |
| `MODERATION_API_KEY` | none | An OpenAI API key. |
| `IMAGE_BASE_URL` | none | Provider base URL, e.g. `https://openrouter.ai/api/v1`. |
| `IMAGE_API_KEY` | none | |
| `IMAGE_MODEL` | none | |
| `IMAGE_API_STYLE` | `images` | `images` calls `/images/generations` (`b64_json`). `chat` calls `/chat/completions` with `modalities: ["image","text"]` and reads the picture from the reply. |
| `IMAGE_ESTIMATE_USD` | `0.04` | Reserved against the budget per image. |
| `AI_CALL_ESTIMATE_USD` | `0.01` | Reserved against the budget per paid text call. |
| `AI_DAILY_BUDGET_USD` | `0` | `0` means unlimited. **Set a cap in production.** |
| `AI_MONTHLY_BUDGET_USD` | `0` | `0` means unlimited. |
| `AI_KILL_SWITCH` | `false` | `true` makes every AI call answer "temporarily unavailable". |
| `TIERS_JSON` | built-in | JSON overriding per-tier daily limits: `{"free":{"aiPathsPerDay":5,"visualsPerDay":1,"imagesPerDay":1},"pro":{...},"max":{...}}`. Defaults are in `src/config/tiers.ts`. |

### Media storage (Cloudflare R2)

Set **all four** of `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, or none.
A partial set fails validation. With none, media calls answer `PRECONDITION_FAILED` and narration and
images are not stored. See [ADR 0001](adr/0001-object-storage.md) and
[media-storage-plan.md](media-storage-plan.md).

| Variable | Default | Notes |
|---|---|---|
| `S3_ENDPOINT` | none | R2: `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | none | |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | none | An R2 API token scoped to the bucket. |
| `S3_REGION` | `auto` | Correct for R2. |

The browser plays narration from the API origin and from `*.r2.cloudflarestorage.com`; both are allowed in
the CSP in [`apps/web/vercel.json`](../apps/web/vercel.json). Update it if you front the bucket with a custom domain.

### Sandbox

| Variable | Default | Notes |
|---|---|---|
| `SANDBOX_ENABLED` | `false` | Per-learner Docker shell. Needs a Docker socket, which Render does not provide. Keep `false` there. |
| `SANDBOX_IMAGE` | `lq-sandbox:dev` | |

## Engine (`services/engine`)

| Variable | Default | Notes |
|---|---|---|
| `LLM_MODEL` | **required** | LiteLLM string: `openai/<model name as the provider spells it>` for any OpenAI-compatible endpoint. |
| `LLM_API_BASE` | none | The endpoint's `/v1` base URL. NVIDIA NIM uses `https://integrate.api.nvidia.com/v1`. |
| `LLM_API_KEY` | none | Ollama accepts any non-empty string. |
| `LLM_JSON_MODE` | auto | `schema`, `object` or `off`. Falls back from `schema` to `object` if the server rejects it. Do not leave it blank. |
| `LLM_TIMEOUT_S` | `120` | |
| `LLM_MAX_TOKENS` | `8000` | |
| `ENGINE_TOKEN` | **required** | 32+ characters; same value as the API's. |
| `PORT` | `8000` | Render injects this. |

`GET /healthz` on the engine needs no token and makes no model call, so it is the right target for a
keep-alive. More in [services/engine/README.md](../services/engine/README.md).

## Frontend (`apps/web`)

No runtime environment variables. The browser calls `/api/*` on its own origin and
[`apps/web/vercel.json`](../apps/web/vercel.json) rewrites that to the Render API URL. If the API's
hostname changes, edit the rewrite and the `connect-src` / `media-src` entries in the CSP.

## Local development

Copy `apps/api/.env.example` and `services/engine/.env.example`. `docker compose up` starts Postgres,
the engine and the API; it needs `ENGINE_TOKEN` exported and `services/engine/.env` filled in.
