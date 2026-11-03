# Visual rendering

This guide describes the current JSON visual system and how to add a catalog
block. It covers the shared catalog and web renderer. Learn and game-practice
lesson paths depend on LQ-37 and are not marked complete here. Image generation
is skipped under LQ-62.

## Current flow

1. `packages/ui-catalog/src/blocks/` defines block schemas and descriptions;
   `packages/ui-catalog/src/core/parse.ts` registers the allowed block types.
2. `packages/ui-catalog/src/gen/main.ts` generates
   `packages/ui-catalog/visual.schema.json` and
   `packages/ui-catalog/visual.catalog.md` from that registry.
3. `services/engine/scripts/sync_visual_prompts.py` copies the catalog and
   schema into `services/engine/learnquest_engine/prompts/`. Eligible engine
   lesson prompts receive this visual contract. The engine validates output.
4. The API validates incoming visual documents before persistence. The web
   app parses them again in `apps/web/src/blocks/VisualView.tsx` and maps block
   types to `View.tsx` files through `apps/web/src/blocks/registry.ts`.

## Add a block

1. Add its schema, validation, and learner-readable `describe` function under
   `packages/ui-catalog/src/blocks/<type>/`, then register and export it through
   the catalog's parser and `packages/ui-catalog/src/index.ts`. Follow nearby
   blocks for property limits, required `alt` text, and sanitization.
2. Add `apps/web/src/blocks/<type>/View.tsx` as the default renderer. It receives
   a validated `block`; render text as text, expose accessible names, and keep
   controls keyboard usable. The registry discovers these `View.tsx` files by
   folder name.
3. Add focused tests for parsing and the renderer's model or interactions,
   following adjacent block tests. Add or update a fixture if it helps exercise
   engine validation.
4. Regenerate the catalog files with the package's `gen` command, then run
   `services/engine/scripts/sync_visual_prompts.py` so the prompt copies match.
5. Render a valid example in the visual dev page and check the invalid/fallback
   path. This is a manual review step, not evidence of a device accessibility
   pass or a deployed CSP check.

`run` is reserved for the Daytona server-only code runner and is not an
available visual block. Do not add a browser execution path for it. Adding
images requires the separate LQ-62 image pipeline, which is skipped.

## Known incomplete work

- LQ-37 learn and game-practice paths are not claimed done by this guide.
- LQ-62 image pipeline is skipped.
- Owner-only work remains: approve self-harm support copy, configure
  `MODERATION_API_KEY`, run the live eval, complete physical-device and
  assistive-technology checks, and verify the deployed Vercel CSP.
- The eval threshold, provider prices, and tier budgets are owner placeholders,
  not final values. See [visual eval notes](evals/README.md).
