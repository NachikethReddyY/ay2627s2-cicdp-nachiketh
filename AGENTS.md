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
- **No free-chat tutor** in core. Interaction is structured (quiz, game, replay, practice).
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
| `docs/` | Plans, ADRs, diagrams |
| `DESIGN.md` | Visual design system (sticker style, Pip the sprout mascot) |

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
- **Ask first** before changing product scope, audience, the learner model, or anything that touches auth, billing or deployment.

## Where to look

- `docs/plan.md`: detailed product plan (2026-11-06 pivot applied).
- `docs/idea.md`: pitch and research.
- `DESIGN.md`: visual design system.
- `README.md`: local setup and engine configuration.

## Open work after the pivot

Done on 2026-11-06: `docs/plan.md` re-scoped (tracks, 13+ audience, game parts, second track as stretch), `docs/idea.md` rewritten, `docs/plan.html` regenerated, README, AGENTS and CLAUDE updated.

1. Define the concept catalogue for the JavaScript and TypeScript track (first set: variables, conditionals, loops, functions).
2. Wire game and diagram parts into lesson steps in the web player. The blocks exist in `packages/ui-catalog` (grid, order, match, sort, physics, quiz) and the engine has a `game_practice.md` prompt. Check end to end; this is not verified.
3. Decide the second track. The plan's default is Python basics; JavaScript and TypeScript stay first.
4. Agree the presentation-day demo: a seeded set of lessons that works without live generation.
