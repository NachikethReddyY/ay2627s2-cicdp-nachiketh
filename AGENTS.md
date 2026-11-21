# AGENTS.md

Shared instructions for every coding agent working in this repo. `CLAUDE.md` imports this file and adds only Claude Code specifics.

## What we are building

LearnSlop is an interactive **programming learning tool**. A learner picks a programming concept or a real code change and the engine turns it into a short, adaptive lesson that mixes diagrams, code replay, quizzes, games and in-browser practice. The engine picks the mix, the hint depth and the next lesson from a learner model (BKT per learner and concept).

- **Audience**: beginners and early-career developers, 13 and over, JavaScript and TypeScript first, then other languages.
- **Not for children.** Do not add child profiles, age bands, parental consent or kids-specific UI. The KidsQuest world (ages 4 to 10) is dropped (pivot logged at the top of `docs/plan.md`).

## Principles that hold

- **Predict before reveal.** Ask for a prediction, then show the answer. Never show the answer first.
- **Hints and answers are server-side only.** Never ship expected output or answer keys to the client.
- **Model-agnostic AI.** Engine calls go through an OpenAI-compatible interface (LiteLLM). No provider lock-in.
- **Generated content is reviewed.** An LLM drafts lessons, quizzes and games. A human author approves before publish.
- **Sloppy is the AI help chat.** It answers a learner who is stuck in practice, and it does not hand over finished solutions. Its guardrails keep the full answer out; hints and the answer key stay server-side.
- **Learning first, demo second.** Prefer features that improve measurable learning over decoration.

## Repo map

| Path | What it is |
|---|---|
| `apps/api` | Fastify + tRPC API, Postgres via Drizzle, auth (Better Auth) |
| `apps/web` | React + Vite web app: player, lessons, practice, explore |
| `services/engine` | Python LLM engine (`learnquest_engine`), generates lessons and quizzes |
| `services/sandbox` | Code execution sandbox (Daytona backend) |
| `packages/player-core` | Shared timeline and replay logic |
| `packages/ui-catalog` | Shared UI blocks, including diagram and scene blocks |
| `tools/` | Developer and agent tooling (repo index and MCP server), not shipped |
| `scripts/` | Repo checks, merge gate, review pipeline, metrics, with tests |
| `docs/` | Plans, ADRs, diagrams, design references. Agent guides in `docs/agents/` |
| `DESIGN.md` | Visual design system (Geist, glass, light and dark, Pip the sprout mascot) |

## Commands

```bash
pnpm install
ENGINE_TOKEN=<token> docker compose up postgres          # Postgres 16
pnpm --filter @learnquest/api db:migrate                 # needs apps/api/.env
pnpm dev                                                 # API + web
TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test \
  pnpm exec turbo run lint test build
cd services/engine && uv run ruff check learnquest_engine tests scripts \
  && uv run mypy --strict learnquest_engine && uv run pytest
```

`TEST_DATABASE_URL` must end in `_test`; the API test helper refuses any other name. The default port is 5432 (`docker-compose.yml`, CI, test helper). If your test Postgres is elsewhere, such as 5433, set `TEST_DATABASE_URL` to it.

## Working rules

- **Keep going.** When a step does not need the user's input, continue. Stop and ask only when you cannot proceed without them, or before anything destructive (deleting data, force-pushing, changing anything outside this repo) or hard to reverse.
- **Verify before claiming.** Run the checks. Say what you ran and what passed, and say plainly which checks were skipped or failed.
- **Before a PR push**, run the full CI (`turbo run lint test build`) against a test Postgres. No pushing on partial checks.
- **Small change sets.** One concern per PR. Update the relevant doc in the same PR when behaviour or scope changes.
- **Commits** use Conventional Commits, `type(scope): description`, with body lines wrapped at 72 characters.
- **Data.** Do not add learner or child data beyond account email, attempts and mastery.
- **Ask first** before changing product scope, audience or the learner model. Changes to auth, billing and deployment are allowed, but only through the sensitive merge gate (see Merging).

## Foundations first

Fix the foundations before building on top. If the inner loop (lint, types, tests, boundaries) lets slop through, automating it only produces more slop faster. When an agent makes a mistake, the fix goes in this order:

1. Change the code or API so the mistake cannot be written.
2. Add a deterministic check: a lint rule, a boundary check, a test, a property test.
3. Only then, and only if judgement is needed, write it in a skill or in this file.

Never add a prose rule for something a check can catch. Agents copy the code they see, so clean up an anti-pattern the same time you ban it.

## Guardrails in code

Every correction becomes a check. These run in CI and in `pnpm agent:verify`.

- **Type-aware lint.** `pnpm lint:types` runs oxlint with type-aware rules (oxlint-tsgolint, built on the TypeScript 7 compiler, so it works where typescript-eslint does not). Errors fail. Warnings are a ratchet capped by `--max-warnings` in the root `package.json`; lower the number when you fix some, never raise it.
- **No comments.** `pnpm lint:comments` (also run by `test:scripts`) fails on any comment in TypeScript or JavaScript. Make the code say it: a better name, a smaller function, a test that states the rule. Directives are allowed only with a reason after `--`: `eslint-disable`, `oxlint-disable`, `@ts-expect-error`. `node scripts/check-comments.ts --fix` strips banned comments. Comments rot, agents use them to justify shortcuts, and nothing enforces them.
- **No new `useEffect` or timers.** `apps/web/eslint.config.js` bans new `useEffect` and imperative timers in product code and limits web imports from the API to `import type { AppRouter } from "@learnquest/api/router"`. Files that already use a pattern sit in `apps/web/eslint.allowlists.js`, which only shrinks. A test fails if a list grows or holds a stale entry.
- **Boundaries.** `scripts/check-boundaries.ts` keeps `packages/*` from importing apps, keeps the API from importing the web app, and rejects `@ts-ignore`, `@ts-nocheck` and bare `eslint-disable`. It also forbids disabling `no-restricted-syntax` or `no-restricted-imports`.
- **Python.** Ruff in `services/engine` checks for stray `print` (`T20`), security smells (`S`) and bare `noqa` or `type: ignore` (`PGH003`, `PGH004`), and mypy runs `--strict`. `#` comments are banned too: `services/engine/scripts/check_comments.py` (run by pytest) allows only coded directives such as `# noqa: S101` and `# type: ignore[code]`, and `--fix` strips the rest. Docstrings are not comments and stay.
- **Property tests.** Invariants that must hold for any input (predict before reveal, mastery bounds, seeking) are property tests, not examples. See `*.property.test.ts`.
- **Revert rate.** `pnpm revert-rate` reports the share of changes on main that were reverted. Watch it; if it rises, tighten the checks.
- When you fix the same kind of mistake twice, add the check in the same PR. Make the error message say how to fix the cause.

## Verification loop

To see or test the running app, use the validator: `pnpm validator:up` starts Postgres-backed API, web and a fake LLM and signs in a test learner, `pnpm validator browse ...` drives it with agent-browser, `pnpm validator:down` stops it. See `docs/agents/validator.md`. It needs no Docker and no model key.

Before you claim a change works, run `pnpm agent:verify`. It runs the type-aware lint, boundaries and comment checks, the script tests, `turbo run lint test build` against the test Postgres, and the engine checks. Say what ran and what passed. A change that touches a screen also needs the running app: see `docs/feature-map.md` for the names and `e2e/` for the Playwright suite.

## Merging

Agents merge their own PRs through the trusted bootstrap from `origin/main`. The PR must be open, out of draft, mergeable, green on the head commit, and clear of requested changes and unresolved review threads. Local verification must pass. The gate squash-merges the exact head, and a merge to main deploys to production after CI. The gate stops agent merges while the 30-day revert rate exceeds 5%.

PRs that touch sensitive paths require a clean strict review run by the trusted gate on the exact head and base. Once this policy lands on main, run the bootstrap from your PR checkout using your PR number and author family.

```bash
git fetch origin +refs/heads/main:refs/remotes/origin/main &&
  git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh &&
  git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- 123 --author codex
```

The current policy on main applies until then. The operator declares the author family with `--author`, and the gate checks the returned review against that declaration. Authorship depends on the operator’s accuracy. Strict Codex review is unavailable, so a Claude-authored sensitive PR remains blocked. The gate requires `lint`, `unit`, `engine`, `deploy-scripts`, and `e2e` to succeed and a clean checkout of the PR head. Product scope, audience and learner-model changes still need the owner (see Ask first).

## Where to look

- `docs/plan.md`: detailed product plan (2026-11-06 pivot applied).
- `docs/idea.md`: pitch and research.
- `DESIGN.md`: visual design system.
- `README.md`: local setup and engine configuration.
- `docs/agents/README.md`: how agents work here, the verification loop, merge and review.
- `docs/feature-map.md`: learner-facing names for screens and features, with routes and code.

## Open work after the pivot

Done on 2026-11-06: `docs/plan.md` re-scoped (tracks, 13+ audience, game parts, second track as stretch), `docs/idea.md` rewritten, `docs/plan.html` regenerated, README, AGENTS and CLAUDE updated.

1. Define the concept catalogue for the JavaScript and TypeScript track (first set: variables, conditionals, loops, functions).
2. Wire game and diagram parts into lesson steps in the web player. The blocks exist in `packages/ui-catalog` (grid, order, match, sort, physics, quiz) and the engine has a `game_practice.md` prompt. Check end to end; this is not verified.
3. Decide the second track. The plan's default is Python basics; JavaScript and TypeScript stay first.
4. Agree the presentation-day demo: a seeded set of lessons that works without live generation.
