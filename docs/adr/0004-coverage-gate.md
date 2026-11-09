# ADR 0004: Coverage gate for the API, web and engine

Status: Proposed (LQ-26). The owner must approve the numbers below before this moves to Accepted.

## Context

Tests run in CI (`.github/workflows/ci.yml`), but nothing stops a merge when
coverage drops. A large change can remove tests and CI stays green. LQ-26 adds a
coverage gate to each package so that coverage cannot fall below a floor without
a failing check.

## Decision

Each package fails its test run when coverage is below its threshold.

- **apps/api** (Node test runner): `test` runs with `--experimental-test-coverage`,
  `--test-coverage-lines=87`, `--test-coverage-branches=83`, and
  `--test-coverage-exclude='**/*.test.ts'`.
- **apps/web** (Node test runner): `test` runs with the same flags, using
  `--test-coverage-lines=81` and `--test-coverage-branches=84`.
- **services/engine** (pytest + pytest-cov): `addopts` in `pyproject.toml` runs
  `--cov=learnquest_engine` on every `pytest` run, and `[tool.coverage.report]
  fail_under = 94` sets the floor. The engine gate measures statement coverage.
  Branch coverage is not configured.

The CI jobs that run these commands are the existing `turbo run lint test build`
step and `uv run pytest`. Whether a failing gate blocks a merge depends on branch
protection requiring those checks. This ADR does not change branch protection.

### Measured baselines

Measured on this branch with the same flags as the gate, on a clean Postgres 16
test database (migrated). The API suite was run with `BETTER_AUTH_SECRET` set,
as CI does.

| Package | Lines | Branches | Functions | Tests |
|---|---|---|---|---|
| apps/api | 89.08% | 85.39% | 77.83% | 291 pass, 1 skipped, 0 fail (292) |
| apps/web | 83.39% | 86.72% | 75.62% | 198 pass, 0 fail |
| services/engine | 96.81% statements (752 stmts, 24 missed) | not measured | not measured | 205 pass |

The API numbers varied by about 0.1 points across runs on the same database. Both
runs floored to the same integers, so the thresholds did not move.

Functions coverage is measured and shown by Node, but it is not gated. The ADR
only gates lines and branches.

### Thresholds

Each threshold is the measured baseline rounded down, minus 2 points.

| Package | Metric | Baseline (floor) | Threshold |
|---|---|---|---|
| apps/api | lines | 89 | 87 |
| apps/api | branches | 85 | 83 |
| apps/web | lines | 83 | 81 |
| apps/web | branches | 86 | 84 |
| services/engine | statements | 96 | 94 |

### Rule: thresholds only go up

A threshold may be raised when coverage rises. It may never be lowered in a
pull request. A change that lowers a threshold needs a separate ADR update and
the owner's approval.

### Owner approval

The owner approves these numbers, not the author. The author chose them from
the measured baselines. Changing a threshold, in either direction, needs the
owner's approval as well.

## Verification

- `pnpm test` in `apps/api`: coverage met the 87/83 thresholds in every run
  (lines 89.02 to 89.08, branches 85.39 to 85.46). Of the three full runs with
  the gate on, two exited 1 because `the server exits cleanly on SIGTERM` failed
  (a race, see Consequences). The third run, with lines raised to 99 to test
  the gate, passed all tests and failed only on the threshold. With the real
  thresholds, coverage met the floor in both runs. Raising lines to 99 failed
  with `89.08% line coverage does not meet threshold of 99%` (exit code 1).
- `pnpm test` in `apps/web` passes at 81/84 and fails when lines is raised to 99
  (exit code 1: `83.39% line coverage does not meet threshold of 99%`).
- `uv run pytest` in `services/engine` passes at 94 and fails when `fail_under`
  is raised to 99 (exit code 1: `Required test coverage of 99.0% not reached`).

Each raised value was reverted before the commit.

## Consequences

- Coverage is affected by test-database state. A shared test database, or one
  used by another run at the same time, gave deadlocks and 401/422 failures in the
  API suite, and the coverage numbers moved with them. Measure and run the gate
  on a database that no other run uses. Any `TEST_DATABASE_URL` must end in `_test`.
- Known blocker for a green API gate: `test/sec-hardening.test.ts`, "the server
  exits cleanly on SIGTERM", races `src/server.ts`. The test sends SIGTERM as
  soon as it sees the listen log. The handler is registered after
  `await app.listen()` (`src/server.ts`, line 31), so the signal can arrive
  first and the process exits with `null`, not 0. Fix it in a separate change
  (register the handler before listen, or have the test wait for a later log
  line). This ADR does not touch either file.
- A raised threshold makes the next pull request that lowers coverage fail.
  That is intended.
- `pytest-cov` is a new dev dependency in `services/engine`.

## Not done

- Branch coverage for the engine.
- Gating functions coverage.
- Per-file thresholds.
- Making the gate a required check in branch protection. This needs the owner.
