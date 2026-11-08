# ADR 0003: Engine boundary: all LLM calls go through the Python engine

Status: Accepted

## Context

AGENTS.md requires model-agnostic AI: engine calls go through an OpenAI-compatible
interface (LiteLLM), with no provider lock-in.

Before this change, `apps/api/src/ai/generator.ts` called the Anthropic SDK directly.
It did this for outlines (when `ANTHROPIC_API_KEY` was set) and for predict lessons.
Other lesson parts already went through the engine. That split broke the rule and left
two places that knew about a provider.

The engine already exists: `services/engine`, package `learnquest_engine`, a FastAPI
app. Its LLM calls go through LiteLLM in `learnquest_engine/llm.py`. It is stateless
(JSON in, JSON out).

## Decision

The Python engine is the only component that calls a text LLM provider.

- The API reaches the engine over HTTP through `apps/api/src/engine-client/client.ts`.
  Outlines use `POST /v1/pipeline/outline`. Lessons use `POST /v1/pipeline/lesson`,
  including predict lessons.
- Each request sends the shared token in the `x-engine-token` header. The engine
  compares it with `hmac.compare_digest` in `learnquest_engine/server.py`.
- The API holds no text-model key. `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are removed
  from `apps/api/src`.

Not covered by this decision: the API still calls two other providers directly.
Image generation uses `IMAGE_BASE_URL`, `IMAGE_API_KEY` and `IMAGE_MODEL`
(`apps/api/src/media/imagegen.ts`). Moderation uses `MODERATION_API_KEY`
(`apps/api/src/safety/moderation.ts`). Moving these behind the engine is a separate
decision.

## Validation

Model output is untrusted at every hop.

1. **Engine.** `llm.generate` checks the reply against the Pydantic models in
   `learnquest_engine/schemas.py`. On failure it makes one repair call that sends the
   exact validation errors back. If the repair also fails, the engine raises
   `GenerationError`, and `server.py` answers 422 `invalid_output`.
   A reply cut off at the token limit is not repaired, because resending it would not help.
   Game-practice parts have one extra repair in `pipeline.py` (`_checked_game`).
   Visual documents are checked as described in [ADR 0002](0002-visual-trust-model.md).
2. **API.** `apps/api/src/ai/service.ts` validates the engine's output with zod before
   it is stored or returned. Engine JSON is not passed straight to the learner.
3. **Browser.** The web renderer parses visual data again (ADR 0002).

## Answer keys

The engine response includes answer fields. Multiple-choice output has `answer`.
Cloze output has `answer` and `accepted`. The API keeps them server-side.

The learner-facing rules, as the code enforces them today:

- `lessons.get` selects only the step columns it needs. It does not select
  `steps.secret`, which holds `answer`, `accepted` and the hunks.
- `lessons.get` removes `expectedOutput` from practice parts
  (`apps/api/src/lessons/router.ts`).
- `steps.reveal` returns `answer` only after the step is revealed or skipped
  (`apps/api/src/attempts/router.ts`).
- `apps/api/test/attempts.test.ts` checks learner payloads against a forbidden-key list
  (`secret`, `answer`, `accepted`, `hunks`, `explanations`, `source`).

So the rule is "not before reveal", not "never returned". Any new learner-facing route
must be checked against the same list.

## Consequences

- One place to change providers and prompts. Provider settings are `LLM_MODEL`,
  `LLM_API_BASE` and `LLM_API_KEY`. Prompts live in `learnquest_engine/prompts`.
- Outlines and lessons need the engine running. The API reaches it at `ENGINE_URL`
  (default `http://localhost:8000`). If the engine is down, the API returns an error
  and the learner gets "Couldn't build that path" for outlines.
- Without `ENGINE_TOKEN` in `apps/api`, `paths.generate` answers `PRECONDITION_FAILED`
  ("AI is not configured") (`apps/api/src/ai/service.ts`).
- New config surface:
  - API: `ENGINE_URL`, `ENGINE_TOKEN` (optional, at least 32 characters), `ENGINE_TIMEOUT_MS`
    (default 400000).
  - Engine: `ENGINE_TOKEN` (required, at least 32 characters, checked at startup),
    `LLM_MODEL`, `LLM_API_BASE`, `LLM_API_KEY`.
  - The two `ENGINE_TOKEN` values must match.
- The engine's total request budget must stay below the API timeout
  (`learnquest_engine/config.py` says so).
- Text generation no longer needs an Anthropic key. Image and moderation keys are still
  needed for those features, as listed above.

Status of the code: the API no longer calls a text LLM provider. The change is
not on `main` until its PR merges.

## Out of scope

- The `beforeFiles` leak check (WP6 in `docs/plan.md`).
- Ingest. `docs/plan.md` plans `POST /v1/pipeline/ingest`, but the engine does not
  implement it yet.
