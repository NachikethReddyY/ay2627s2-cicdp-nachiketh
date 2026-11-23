# AI spend dashboard

Admins can open **Admin** from Account or visit `/admin`. The server checks the signed-in account's linked `learners.is_admin` flag on each dashboard request. A signed-in learner without that flag receives HTTP 403.

The dashboard shows daily and month-to-date totals in UTC for calls that reported token usage. Each provider response with usage counts as one call, including repair calls and responses whose generated output was rejected. Usage appears after the API receives the engine response. The dashboard covers model calls made through the engine's text generation pipeline. Direct image generation, moderation, and provider failures without token metadata are outside this measurement.

The `ai_call_spend` table stores only the UTC day, prompt tokens, completion tokens, and the estimated USD cost per call. The model name travels with usage inside the engine-to-API response to select a price. The API stores no model name, learner identifier, operation, or prompt. The existing `spend_ledger` continues to enforce AI budget reservations.

Set the USD price per million prompt and completion tokens for your engine's exact `LLM_MODEL` in [ai-model-prices.ts](../apps/api/src/config/ai-model-prices.ts). Estimates use standard token rates at the time the API records the call. Calls with no matching price still contribute to call and token totals. The dashboard marks those calls as unpriced, and USD totals sum the priced portion.
