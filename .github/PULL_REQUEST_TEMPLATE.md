## Problem

<!-- One or two sentences: why this change matters, in the reporter's words where possible. -->

## Change

<!-- A few bullets on what changed and why. Not an inventory of files. -->

-

## Testing

<!-- Commands run and their result, for example:
TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test pnpm exec turbo run lint test build
Engine checks if services/engine changed: ruff, mypy --strict, pytest.
Say which checks were skipped and why. -->

## Risk

<!-- low, medium or high, and why. Name any sensitive area touched: auth, answer data sent to the client, secrets, sandbox, migrations, billing, deployment, CI workflows. -->

## How to revert

<!-- A revert, a flag, or a data step. -->

## Checklist

- [ ] CI green locally (full `turbo run lint test build` against a test Postgres)
- [ ] Docs updated if behaviour or scope changed
- [ ] No secrets or real learner data in the diff
- [ ] No expected output or answers sent to the client
- [ ] No child data added (the audience is 13+)
