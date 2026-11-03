# Visual generation evals

`services/engine/scripts/eval_visuals.py` runs 30 lesson-part topics across 6 subjects
(coding, math, science, history, language, economics) and reports how often the model returns
a **schema-valid visual document**, which block types it chooses, and what that costs.

## Two modes

| Mode | Command | Calls a model? | Who runs it |
|---|---|---|---|
| Dry run (default) | `uv run python scripts/eval_visuals.py` | No, replays `tests/fixtures/part_learn*.json` | Anyone, CI-safe |
| Live | `uv run python scripts/eval_visuals.py --live --json-out docs/evals/latest.json` | Yes | **Owner only** |

The live run needs `LLM_MODEL`, `LLM_API_KEY` and `ENGINE_TOKEN` in `services/engine/.env` and
spends real money. It refuses to start without a key. The dry run proves the harness works; its
numbers say nothing about model quality because every reply is a recorded fixture.

## Metrics

- **Pass rate**: parts whose `doc` survives `visual.validated` (the committed JSON schema, the
  same check `pipeline.lesson` applies). The text `body` is always kept; a bad `doc` is dropped.
- **First-try pass rate**: passed with `attempts == 1`, i.e. no repair round.
- **Skipped**: topics where the model returned no valid part at all.
- **Block mix**: count of block `type`s across all valid documents.
- **Cost per part**: mean token cost per topic using the price inputs.
- **Cost per tier**: cost per part × a tier's daily visual budget, per user, per day and per 30
  days.

`--json-out PATH` writes the same numbers as JSON for a record. `--limit N` shortens the run.

## Placeholders (owner decides)

Nothing below is a final number; the script prints every one as `PLACEHOLDER`.

| Knob | Current | Where |
|---|---|---|
| Pass threshold | 85% first-try | `PASS_THRESHOLD` |
| Token prices | $0.15 in / $0.60 out per 1M | `Prices` |
| Tier visual budgets | free 1, pro 4, max 10 per day | `TIER_VISUALS_PER_DAY` |

Prices and budgets mirror today's provider and LQ-63 defaults and must be replaced with the
owner's real values before any cost figure is used for a decision.

## Decision the live run informs

If the first-try pass rate is below the owner's threshold, the plan's provisional next step is
two-step generation (generate the explanation, then a separate visual call) and reopening LQ-66.
The 85% bar is provisional. No agent may record a live result it did not observe.

## Recording a result

Copy this into `docs/evals/latest.md` (or a dated file) after a live run the owner performed:

```markdown
# Visual eval <date>

- Model: <LLM_MODEL>
- Run by: <owner>
- Mode: live, <N> topics
- Pass rate: <x%> (<n>/<N>)
- First-try pass rate: <x%> (<n>/<N>)
- Block mix: <text n, chart n, ...>
- Cost per part: $<x>
- Cost per tier per user: free $<x>/day, pro $<x>/day, max $<x>/day
- Threshold: <x%> (owner-set) -> met / not met
- Decision: keep one-step / consider two-step
- Note: <anything the numbers do not show>
```

## Not covered

- Live image generation (LQ-62) and the API-side gate (LQ-64); this measures the engine part
  and its document only.
- Multiple models or repeat runs per topic. One run is a sample, not a benchmark.
- Real provider prices, latency, or tier enforcement.
