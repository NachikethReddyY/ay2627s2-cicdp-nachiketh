# Contributing to LearnSlop

Thanks for helping. LearnSlop is an interactive programming learning tool for beginner and early-career developers, starting with JavaScript and TypeScript. Read [README.md](README.md) for an overview and [AGENTS.md](AGENTS.md) for the product direction, repo map and working rules. The detailed plan is in `docs/plan.md`.

## Who can contribute

Anyone is welcome to open an issue or a pull request. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, follow [SECURITY.md](SECURITY.md) and do not open a public issue.

The audience is learners aged 13 and over. We do not target children, so do not add child profiles, age bands, parental consent or kids-specific UI.

## Set up locally

Follow the "Local development" section of [README.md](README.md). In short, you need Node with pnpm, Docker for Postgres 16, and `uv` for the Python engine in `services/engine`. The README has the exact commands, and the engine setup is in [services/engine/README.md](services/engine/README.md).

## Branches

Branch from `main` and name the branch `type/short-description`, using one of:

- `feat/` for a new feature
- `fix/` for a bug fix
- `refactor/` for a change that does not alter behaviour
- `docs/` for documentation only
- `ci/` for workflows and pipeline changes
- `chore/` for maintenance

Example: `fix/practice-run-timeout`.

## Commits

Use Conventional Commits: `type(scope): description`.

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, `ci`, `chore`, `style`, `build`, `revert`.

- Keep the description short and in the imperative mood.
- Wrap body lines at 72 characters.
- Mark breaking changes with `!` after the type, or add a `BREAKING CHANGE:` footer.
- Link issues with `Closes #N`, `Fixes #N` or `Refs #N`.

Example:

```text
fix(web): stop the terminal from resetting on resize

The terminal remounted when the panel size changed, which dropped the
running session.

Fixes #123
```

## Run the full CI before you push

Run the full CI locally before pushing a PR. Do not push on partial checks.

```bash
TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test \
  pnpm exec turbo run lint test build
```

- This needs a running test Postgres. The default port is 5432 (`docker-compose.yml`, CI and the test helper).
- If your test Postgres is on another port, such as 5433, set `TEST_DATABASE_URL` to match.
- `TEST_DATABASE_URL` must end in `_test`. The API test helper refuses any other database name.

If you changed `services/engine`, also run the engine checks:

```bash
cd services/engine && uv run ruff check learnquest_engine tests scripts \
  && uv run mypy --strict learnquest_engine && uv run pytest
```

In the PR description, say what you ran. If a check was skipped or failed, say so.

## Pull requests

- One concern per PR, and keep the change set small.
- Update the relevant doc in the same PR when behaviour or scope changes.
- Add or update tests for the change.
- Open the PR against `main`. Branch protection on `main` requires the `lint`, `unit` and `engine` status checks to pass, an up-to-date branch, resolved review threads, and linear history. Merges are squash or rebase.
- Area labels are applied automatically from the files you touch.

## Project principles

These hold for every change (see [AGENTS.md](AGENTS.md) for the full list):

- Predict before reveal: ask for a prediction, then show the answer.
- Hints and answers stay server-side. Never ship expected output or answer keys to the client.
- Engine calls go through an OpenAI-compatible interface. No provider lock-in.
- Generated lessons, quizzes and games are reviewed by a human author before publish.
- No free-chat tutor in core. Interaction is structured.

## Data and privacy

Do not add learner or child data beyond what a lesson needs: account email, attempts and mastery. Do not add new personal data categories without asking first.

## Ask first

Open an issue or ask a maintainer before changing:

- the product scope or the target audience
- the learner model
- anything that touches auth, billing or deployment

## Questions

Open an issue if something here is unclear or out of date.
