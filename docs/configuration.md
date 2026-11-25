# Configuration

Selected environment variables for the API and engine.

## Models and routers

| Modality | Router | Key variable | Model variable | Current value or default | Status |
| --- | --- | --- | --- | --- | --- |
| Text | TokenRouter via LiteLLM when configured | `TOKENROUTER_API_KEY` or `LLM_API_KEY` | `LLM_MODEL` | Required. The engine example uses `openai/gpt-5.1-mini`. | Live |
| Image | TokenRouter | `TOKENROUTER_API_KEY` or `IMAGE_API_KEY` | `IMAGE_MODEL` | No default | Off in production |
| Text-to-speech | OpenRouter | `OPENROUTER_API_KEY` | `STUDIO_TTS_MODEL` | `hexgrad/kokoro-82m` | Predict narration when configured |
| Speech-to-text | OpenRouter | `OPENROUTER_API_KEY` | `STUDIO_STT_MODEL` | `openai/whisper-large-v3` | Studio when enabled |
| Moderation | OpenAI by default | `MODERATION_API_KEY` | `MODERATION_MODEL` | `omni-moderation-latest` | Live |

- For text on TokenRouter, set `LLM_API_BASE=https://api.tokenrouter.com/v1` and `LLM_MODEL=openai/<confirmed-model-id>` on the engine. `TOKENROUTER_API_KEY` takes precedence over `LLM_API_KEY` when both have values.
- For images, set `TOKENROUTER_API_KEY` and `IMAGE_MODEL` on the API. The TokenRouter key takes precedence over `IMAGE_API_KEY` and defaults `IMAGE_BASE_URL` to `https://api.tokenrouter.com/v1`. An explicit `IMAGE_BASE_URL` overrides the default. Set `IMAGE_API_STYLE=chat` for models served through chat completions. The default `images` uses the image generations endpoint. The legacy key requires an explicit base URL.

Confirm the exact model ID in the router's model list. Within an already configured provider and endpoint style, change only `LLM_MODEL` or `IMAGE_MODEL` and redeploy. Spend reporting resolves the new model's applicable rate automatically. [Pricing source coverage and rollout](ai-spend.md)

## Predict narration

Set these variables on the **Render API service** (`learnquest-api`). The API also needs its existing private S3-compatible media settings (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and optional `S3_REGION`).

| Variable | Value |
| --- | --- |
| `OPENROUTER_API_KEY` | Secret key from OpenRouter. Sets up generation when the media bucket is configured. |
| `STUDIO_TTS_MODEL` | Defaults to `hexgrad/kokoro-82m`. Choose a model with MP3 output if overriding. |
| `STUDIO_TTS_VOICE` | Defaults to `af_heart`. Choose a voice supported by the configured model. |
| `STUDIO_TTS_ESTIMATE_USD` | Defaults to `0.01` per provider request. The API reserves this amount against its shared daily and monthly AI budgets. |

After a learner reveals a prediction, the API requests MP3 audio from `https://openrouter.ai/api/v1/audio/speech` and caches the clip in private storage for that lesson version and step. Kokoro with `af_heart` uses DeepInfra US so the spend report can use the matching character rate when billing metadata is unavailable. Other model and voice combinations use standard OpenRouter routing. The reveal text and code replay load independently. If audio generation or playback fails, the player uses browser speech when available. The API waits 24 hours before retrying failed generation for a step. MP3 playback needs no sample-rate variable or speech-to-text setup.

## Sandbox (LQ-76)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SANDBOX_ENABLED` | `false` | Off: `/sandbox/*` answers 503 and no backend is ever loaded. |
| `SANDBOX_BACKEND` | `docker` | `docker` runs shells, code runs and practice checks on the API host. `daytona` runs them in Daytona sandboxes. |
| `SANDBOX_IMAGE` | `lq-sandbox:dev` | Docker backend only. |
| `DAYTONA_API_KEY` | – | Required when `SANDBOX_ENABLED=true` and `SANDBOX_BACKEND=daytona`; the API refuses to start without it. |
| `DAYTONA_API_URL` | SDK default | Self-hosted Daytona only. |
| `DAYTONA_TARGET` | SDK default | Region to create sandboxes in. |
| `DAYTONA_SNAPSHOT` | Daytona default snapshot | Snapshot with Python 3, Node.js 22.18 or later, GNU timeout and setpriv. Daytona applies the snapshot's CPU, memory and disk limits. The grading harness runs via root or passwordless `sudo` in the disposable check sandbox and uses UID 10001 for learner code. |
| `DAYTONA_AUTO_STOP_MINUTES` | `3` | Idle minutes before Daytona stops a learner's shell sandbox. The Docker backend uses the same 3-minute idle stop. |
| `SANDBOX_MAX_TABS` / `SANDBOX_MAX_SHELLS` / `SANDBOX_MAX_RUNS` | 4 / 50 / 20 | Per-learner tabs, live terminals, live runs. |

## Guide and practice

| Variable | Default | Meaning |
| --- | --- | --- |
| `PRACTICE_STRETCH_TESTS` | `0` | Number of bonus hacker-edition tests (0 to 10) the engine adds to each practice part. They give bonus points only. |
| `AI_WRITE_COURSE_ON_GENERATE` | `true` | When `true`, Postgres jobs plan and build the full path, with at most three active jobs across API replicas. Planning checkpoints retain validated batches. A path can use 1–1,000 lessons, with individual planning calls capped at 12 lessons. Spend is reserved before each model request using the existing budget ledger. New lessons build with self-contained visuals. Optional Predict audio remains available after reveal. Set `false` to use the legacy outline and write-on-open flow. |

### How the Daytona backend works

- **Shell:** one sandbox per learner. The API looks up new shells by name and checks their `app=learnquest`, `role=shell` and hashed learner labels. Existing unnamed shells are looked up by label. The API creates a shell if missing, starts it if stopped, then attaches a PTY. Daytona stops idle shells after three minutes by default. Files persist on disk between sessions.
- **Practice runs:** each run gets its own throwaway sandbox (`role=runner`) with the network blocked, so a learner cannot alter what a graded run sees through their shell (LQ-75). The program gets the same 60 s limit, counted from when it starts (sandbox creation is extra); stdout and stderr stay separate; stdin lines go through a session command. The sandbox is deleted when the run ends.
- Output from either is untrusted data (ADR-0002).

### Render

Set `SANDBOX_ENABLED=true`, `SANDBOX_BACKEND=daytona` and `DAYTONA_API_KEY` (secret). Daytona runs practice checks in disposable sandboxes with networking blocked. The check uses the language declared by the lesson. Interactive Daytona shells also block network access.

### Not yet built

Global active-sandbox cap: on Daytona `SANDBOX_MAX_SHELLS` counts open terminals per API instance, not idle running sandboxes, and a scheduled cleanup of long-stopped `app=learnquest` sandboxes (set Daytona's auto-delete as a stopgap).
