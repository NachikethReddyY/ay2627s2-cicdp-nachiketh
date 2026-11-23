# AI spend dashboard

Admins can open **Admin** from Account or visit `/admin`. The server checks the signed-in account's linked `learners.is_admin` flag on each dashboard request. A signed-in learner without that flag receives HTTP 403.

The dashboard shows UTC daily and month-to-date totals for successful provider responses from engine generation and moderation, and for direct image responses the API can decode. Each response counts as one call, including repair calls and generated output later rejected by validation. Provider errors without usage are outside Neon coverage. Admin includes unpriced calls in call and available token totals. A reported or calculated zero counts as priced.

The `ai_call_spend` table stores only the UTC day, prompt tokens, completion tokens, and nullable estimated USD per call. Calls without reported token counts contribute zero to the token columns. LearnSlop stores no model, learner ID, operation, prompt, or assets in that table. The engine sends its resolved amount in `x-engine-usage` and uses that same amount for PostHog. Both systems preserve costs already recorded.

## Changing models and rolling out

For a provider you already configured, change `LLM_MODEL` or `IMAGE_MODEL` and redeploy the corresponding service. Image model changes apply to new generations using the configured endpoint style. Pricing needs no configuration for supported models. It uses the exact upstream model ID and endpoint. For example, changing the engine model to `openai/openai/gpt-6-luna` on TokenRouter sends the model ID `openai/gpt-6-luna` to that router.

Deploy the API first for consistent Neon and PostHog totals during rollout. The new API accepts usage from older engines and records those calls as unpriced because older headers omit the amount and provider. An older API can still parse a newer engine's header, and continues applying its legacy table until it upgrades.

On the next engine deploy, remove `LLM_INPUT_USD_PER_MTOK` and `LLM_OUTPUT_USD_PER_MTOK` from Render if you want dynamic pricing. If you deliberately need a manual text rate, keep both numbers and set `LLM_PRICE_OVERRIDE_MODEL` to the entire configured `LLM_MODEL` string. Unscoped or incomplete overrides are ignored, including both old variables left in place without a model selector. A complete matching override takes priority over catalog estimates. A valid provider-reported cost takes priority over the override. Review the override if that exact model ID is reused on a different endpoint.

## Sources and units

| Path | Cost source |
| --- | --- |
| TokenRouter text chat | Public default-group rates from `https://api.tokenrouter.com/api/pricing`. Uses the matching prompt-length tier in USD per million tokens when published. Flat text entries use the provider's USD conversion of twice the model ratio per million input tokens and the applicable completion and cache multipliers. |
| OpenRouter text chat | Response `usage.cost` in USD-equivalent credits, including zero. Without a reported cost, the official models catalog supports flat text prices in USD per token plus any published request fee. Conditional pricing and nonzero discounts require a reported cost. |
| Direct OpenAI, NVIDIA NIM, TokenRouter text | Models.dev provides a fallback with exact provider and model entries in USD per million tokens, including published context tiers. Missing rates, models outside the supported text modality, and unidentified endpoints produce an unpriced call. |
| TokenRouter image generations | Counts returned images for default-group models whose catalog explicitly supplies a matching fixed USD-per-image price. Variable, candidate-token, and dimension-dependent prices require their own billing data. |
| OpenRouter image chat | Uses reported `usage.cost`. |
| Moderation | OpenAI's documented free `omni-moderation-latest` and `omni-moderation-2024-09-26` calls on the direct OpenAI endpoint count as zero. Other moderation routes count as unpriced. |

Text estimates use measured prompt and completion counts and the applicable cached read/write or reasoning rates when those quantities are reported. Catalog prices estimate public rates. Account-specific billing, credits, routing fees, and overrides absent from a catalog may differ. The TokenRouter catalog currently lists `openai/gpt-6-luna` at **$0.10 input / $0.50 output per million tokens** below 272,000 prompt tokens and **$0.20 / $0.75** at 272,000 and above. Its `google/gemini-3.1-flash-lite-image` entry lacks verified billing units for image output through chat. The exact `nvidia/nemotron-3.5-super-vl-120b-a12b` price was unavailable for the checked routes. These unsupported calls remain unpriced unless a supported billed cost or a matching text override applies. [TokenRouter catalog](https://api.tokenrouter.com/api/pricing) · [TokenRouter model pricing](https://www.tokenrouter.com/models) · [OpenRouter catalog schema](https://openrouter.ai/docs/api/api-reference/models/get-models) · [OpenRouter usage accounting](https://openrouter.ai/docs/guides/guides/usage-accounting) · [Models.dev](https://models.dev) · [OpenAI moderation](https://platform.openai.com/docs/guides/moderation)

Catalogs refresh in the background per process. A successful read stays fresh for six hours. Fetch or parse failures retry after five minutes and retain the last valid snapshot for up to 48 hours after it was fetched. Calls can be unpriced while a cold cache warms or after it expires. Requests send no content, identifiers, or credentials to the public feeds.

Audio generation and transcription run only on the Studio branch. To price audio, capture the response's billed USD, or the exact provider and model rate alongside metered duration in seconds or minutes, or measured audio input/output token counts for a token-priced model. Text token totals and file size do not establish the audio bill.

`AI_DAILY_BUDGET_USD` and `AI_MONTHLY_BUDGET_USD` continue to apply to reservations in `spend_ledger` using `AI_CALL_ESTIMATE_USD`, `IMAGE_ESTIMATE_USD`, `STUDIO_TTS_ESTIMATE_USD`, or `MODERATION_ESTIMATE_USD` as applicable.

## Counting unpriced calls in PostHog

The engine emits one `$ai_generation` event per provider attempt under `learnslop-engine`, including failed attempts. Events carry `pricing_status` (`priced` or `unpriced`), `$ai_model`, `$ai_provider`, `modality`, and `$ai_is_error`. `$ai_total_cost_usd` is present for priced events, including zero. Legacy events predate `pricing_status`. Direct API image calls appear in Neon only.

Use this query in a PostHog SQL insight. Set the insight's date range to select a reporting period. Add `AND properties.$ai_is_error = false` to count only successful provider responses.

```sql
SELECT
    properties.$ai_model AS model,
    count() AS unpriced_calls
FROM events
WHERE event = '$ai_generation'
    AND distinct_id = 'learnslop-engine'
    AND properties.pricing_status = 'unpriced'
    AND {filters}
GROUP BY model
ORDER BY unpriced_calls DESC
```
