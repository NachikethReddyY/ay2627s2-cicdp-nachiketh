---
name: verify
description: Evidence-before-claims checklist for LearnQuest. Use before saying a change works, is fixed, passes or is done; before a PR push; and after changes to lesson parts, hints, quizzes (mcq or cloze), attempts, auth, the sandbox or the engine prompts. Trigger phrases - "verify", "does this work", "before I push", "check the change", "is this safe to ship", "did the tests pass", "ready for PR".
---

# Verify (LearnQuest)

This skill is a hub. It says what to run and in what order. The rules themselves live in `AGENTS.md` (commands, working rules) and the CI wiring in `.claude/skills/ci-cd-playbook/SKILL.md`. Read those instead of copying them here.

## Principle

Evidence before a claim. Run the command, read its output, then report. A typecheck is not a test run. A passing unit test is not a working UI. If you did not run something, say so by name. Never write "should work".

## Checks, in order

### 1. Full CI (always)

```bash
TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test \
  pnpm exec turbo run lint test build
```

- The database name must end in `_test`. `apps/api/test/helpers.ts` throws "Refusing to run tests" otherwise, because the tests truncate every table.
- The default port is 5432 (`docker-compose.yml`, `.github/workflows/ci.yml`, the helper's fallback URL). If your test Postgres runs on another port, such as 5433, set the port in `TEST_DATABASE_URL`.
- Check the database is up first, do not assume: `nc -z localhost 5432` (or 5433). If it is down, say the API tests were not run. Do not push on partial checks (`AGENTS.md`).
- Turbo reports `cache hit` for tasks it skipped. For certainty after a change that could affect a cached task, add `--force`.

### 2. Engine checks (only if `services/engine` changed)

```bash
cd services/engine && uv run ruff check learnquest_engine tests scripts \
  && uv run mypy --strict learnquest_engine && uv run pytest
```

Turbo does not run these. CI runs them in the separate `engine` job after `uv sync --frozen`.

### 3. Answer-leak check (after any change to lesson, step, hint, quiz or practice responses)

Hints and answers are server-side only (`AGENTS.md`). What the server keeps private, read from the code:

- Step `secret` (`StepSecret` in `apps/api/src/db/schema.ts`): `answer`, `accepted`, `hints`, `hunks`, `beforeFiles`, `explanations`, `concepts`. Only `StepPublic` (`title`, `prompt`, `kind`, `options`) and `hintCount` go out in `lessons.get`.
- Practice parts: `expectedOutput` is stripped in `apps/api/src/lessons/router.ts` and compared server-side by `apps/api/src/parts/practice.ts`.
- Hints are released one rung at a time by `attempts.hint`. The answer comes only from `attempts.reveal`, which requires state `revealed` or `skipped`.

Run:

```bash
pnpm --filter @learnquest/web build   # tsc --noEmit && vite build
grep -rn "expectedOutput" apps/web/dist || echo "no expectedOutput in client bundle"
```

Then run the API leak tests (already part of step 1): `apps/api/test/lessons.test.ts` (forbidden keys list, practice `expectedOutput`) and `apps/api/test/attempts.test.ts`.

Open items, not confirmed from the repo:
- The web build output path. `apps/web/vite.config.ts` sets no `outDir`, so Vite's default `apps/web/dist` is assumed. It is gitignored, and an old `dist` can survive, so rebuild before grepping.
- A grep for field names such as `accepted` or `hints` will false-positive (the web app has its own hint UI). A real client-side answer scan needs the seeded answer strings; no script for that exists in the repo.
- Whether `game-practice` `doc` payloads (z.unknown in `lessons.get`) may carry answer data on purpose is not documented. Check the doc against `packages/ui-catalog/visual.catalog.md` when touching game blocks.

### 4. Lesson-part validity (when part shapes change)

The engine validates generated parts against the committed `packages/ui-catalog/visual.schema.json`. Run these by name when `learn`, `watch`, `practice` or `game-practice` shapes, `schemas.py`, `visual.schema.json` or engine prompts change:

```bash
cd services/engine && uv run pytest tests/test_visual_schema.py tests/test_part_docs.py \
  tests/test_visual_unwrap.py tests/test_visual_route.py tests/test_prompt_sync.py
```

A shape change usually spans `services/engine/learnquest_engine/schemas.py`, `apps/api/src/visuals/gate.ts`, `apps/api/src/db/schema.ts` and the `Lesson` zod in `apps/api/src/lessons/router.ts`. Confirm they agree. The dry-run eval (`uv run python scripts/eval_visuals.py`, see `docs/evals/README.md`) proves only that the harness works; it says nothing about model quality. Never run `--live` (owner only, spends money) and never record a live result you did not observe.

### 5. UI change

Tests do not prove a UI works. Open the change in a browser with the `run` skill (or `pnpm dev`, API plus web) and click through the flow: predict, hint, reveal, or the practice Check. Say what you saw. If you could not open it, write "UI not checked in a browser".

## Report template

```
Ran:
- pnpm exec turbo run lint test build (TEST_DATABASE_URL=...:5433/..._test): PASS | FAIL (what)
- engine ruff / mypy / pytest: PASS | FAIL | not run (engine unchanged)
- client bundle grep for expectedOutput: PASS | FAIL | not run
- UI opened in browser: what I saw | not checked
Skipped: <command> because <reason>
Verdict: <one line, e.g. "CI green locally, UI unchecked" or "Not ready: 2 API tests fail">
```

## Gotchas (verified in the repo)

- The test helper refuses any `DATABASE_URL` not ending in `_test`. It reads `TEST_DATABASE_URL`, never `DATABASE_URL`, and tests truncate every table.
- The `test` turbo task lists `TEST_DATABASE_URL` and `BETTER_AUTH_SECRET` as env inputs; changing them invalidates the cache. Anything else that changes behavior without changing files can still show a cache hit.
- API tests run with `--test-concurrency=1`; do not parallelize them against one database.
- `apps/web` `lint` and `build` both run `tsc --noEmit`. A green `build` therefore also typechecks.
- The engine uses `uv` (`uv sync --frozen`, `uv run ...`), not pip. The `engine` CI job also needs `pnpm install --filter @learnquest/ui-catalog...` because the visual checker runs ui-catalog TypeScript under Node 22.
- `docker compose up postgres` fails without `ENGINE_TOKEN` set (`docker-compose.yml`, `AGENTS.md`). Set it, or run a separate Postgres for tests on another port.
- The `main` ruleset requires checks named `check` and `engine`. Local runs mirror those two jobs, not more.
- `docs/evals/README.md`: dry-run numbers come from recorded fixtures and are not evidence of generation quality.

## Related

- `AGENTS.md`: commands and working rules ("Tests before claims. Say what you ran.").
- `.claude/skills/ci-cd-playbook/SKILL.md`: what CI runs and the required checks.
- `REVIEW.md`: the failures that matter most for review. It is added by PR #37, so cite it only once that PR has merged and the file is on `main`.
