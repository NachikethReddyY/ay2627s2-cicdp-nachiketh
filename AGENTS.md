# AGENTS.md

Instructions for AI coding agents working in this repo. `CLAUDE.md` imports this file.

## What we are building

LearnSlop is an interactive **programming learning tool**. A learner picks a programming concept or a real code change and the engine turns it into a short, adaptive lesson that mixes modalities:

- **Diagrams**: flow, call stack, memory and data-structure pictures that explain how code runs.
- **Code replay**: a commit or snippet is replayed step by step, with the learner predicting each outcome first.
- **Quizzes**: predict-the-output, multiple choice, and fill-in-the-blank checks.
- **Games**: short practice games that reinforce a concept (for example, tracing a loop or ordering the steps of a function call).
- **Practice**: run code in the browser and check it against expected output.

The engine picks the mix, the hint depth and the next lesson from a learner model (BKT per learner and concept).

### Target audience

Learners of programming: beginners and early-career developers learning JavaScript and TypeScript first, then other languages. The audience is 13 and over. We do **not** target children. Do not add child profiles, age bands, parental consent or kids-specific UI. The KidsQuest world (ages 4 to 10) is dropped. `docs/plan.md` and `docs/idea.md` reflect the pivot, and the note at the top of `docs/plan.md` logs it.

### Principles that still hold

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
| `docs/` | Plans, ADRs, diagrams. `docs/plan.md` is the product plan; `docs/idea.md` is the pitch and research |
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

`TEST_DATABASE_URL` must end in `_test`. The API test helper refuses any other name.

## Working rules

- **Run the full CI locally before pushing a PR**: `turbo run lint test build` against a test Postgres. The repo default is port 5432 (`docker-compose.yml`, CI and the test helper). If you run a separate test Postgres on another port, such as 5433, set `TEST_DATABASE_URL` to it. Do not push on partial checks.
- **Keep the change set small.** One concern per PR. Update the relevant doc in the same PR when behaviour or scope changes.
- **Commits** use Conventional Commits: `type(scope): description`, with body lines wrapped at 72 characters.
- **Do not add learner or child data** beyond what a lesson needs (account email, attempts, mastery). No new personal data categories without asking.
- **Tests before claims.** Say what you ran. If a check was skipped or failed, say so.
- **Ask before** changing the product scope, the audience, the learner model, or anything that touches auth, billing or deployment.

## Pending work after the pivot

Done on 2026-11-06: `docs/plan.md` re-scoped (tracks, 13+ audience, game parts, second track as stretch), `docs/idea.md` rewritten, `docs/plan.html` regenerated, and README, AGENTS and CLAUDE updated.

Still open:

1. Define the concept catalogue for the JavaScript and TypeScript track (first set: variables, conditionals, loops, functions).
2. Wire game and diagram parts into lesson steps in the web player. The blocks exist in `packages/ui-catalog` (grid, order, match, sort, physics, quiz) and the engine has a `game_practice.md` prompt. Check end to end; this is not verified.
3. Decide the second track. The plan's default is Python basics; JavaScript and TypeScript stay first.
4. Agree the presentation-day demo: a seeded set of lessons that works without live generation.
