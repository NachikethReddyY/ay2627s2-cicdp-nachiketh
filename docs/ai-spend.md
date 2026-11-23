# AI spend dashboard

Admins can open **Admin** from Account or visit `/admin`. The server checks the signed-in account's linked `learners.is_admin` flag on each dashboard request. A signed-in learner without that flag receives HTTP 403.

The dashboard shows daily and month-to-date totals in UTC for calls that reported token usage. Each provider response with usage counts as one call, including repair calls and responses whose generated output was rejected. Usage appears after the API receives the engine response. The dashboard covers model calls made through the engine's text generation pipeline. Direct image generation, moderation, and provider failures without token metadata are outside this measurement.

The `ai_call_spend` table stores only the UTC day, prompt tokens, completion tokens, and the estimated USD cost per call. The model name travels with usage inside the engine-to-API response to select a price. The API stores no model name, learner identifier, operation, or prompt.

Set both `LLM_INPUT_USD_PER_MTOK` and `LLM_OUTPUT_USD_PER_MTOK` to the configured model's USD prices per million prompt and completion tokens. LiteLLM uses these rates to estimate each generation's cost for PostHog. Generation events share the `learnslop-engine` service identity.

For the Neon spend dashboard, add the exact `LLM_MODEL` value and both per-million token rates to the API price table. The Nemotron 3.5 Super VL entry uses estimated rates from Together AI and DeepInfra. NVIDIA's route price is unconfirmed. The dashboard includes calls with no price in call and token totals, marks those calls as unpriced, and sums USD for priced calls. [API price table](../apps/api/src/config/ai-model-prices.ts)

`AI_DAILY_BUDGET_USD` and `AI_MONTHLY_BUDGET_USD` apply to reservations in `spend_ledger`. Engine operations reserve amounts based on `AI_CALL_ESTIMATE_USD` and the expected number of calls.
