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

The CI jobs that run these commands are `unit` (turbo test) and `engine`
(`uv run pytest`). `.github/rulesets/main.json` requires `lint`, `unit` and
`engine`, so the gates block merge once that ruleset is applied to the live
repository. The live ruleset is changed by the owner, not by this ADR.

### Measured baselines

Measured on this branch with the same flags as the gate, on a clean Postgres 16
test database (migrated), with Node v26.13 locally. CI runs Node 22, and branch
coverage can differ between V8 versions. The first CI run on Node 22 must be
green before the thresholds count as agreed. The API suite was run with
`BETTER_AUTH_SECRET` set, as CI does.

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
the owner's approval. This rule is a convention. Nothing in CI enforces it yet,
so reviewers check threshold changes in `package.json` and `pyproject.toml`.

### Owner approval

The owner approves these numbers, not the author. The author chose them from
the measured baselines. Changing a threshold, in either direction, needs the
owner's approval as well.

## Verification

Each gate was run with the gate on, then with its threshold raised to 99 to
confirm that it fails. Each raised value was reverted before the commit.

| Package | Real thresholds | Raised to 99 |
|---|---|---|
| apps/api | Coverage met 87/83 in both full runs that reached the threshold check (lines 89.02 to 89.08, branches 85.39 to 85.46). Two of three full runs exited 1 on the SIGTERM race (see Consequences), so the API gate was never seen fully green. | Exit 1: `89.08% line coverage does not meet threshold of 99%` |
| apps/web | Passes at 81/84 | Exit 1: `83.39% line coverage does not meet threshold of 99%` |
| services/engine | Passes at 94 (96.81%) | Exit 1: `Required test coverage of 99.0% not reached` |

## Consequences

- Coverage is affected by test-database state. A shared test database, or one
  used by another run at the same time, gave deadlocks and 401/422 failures in the
  API suite, and the coverage numbers moved with them. Measure and run the gate
  on a database that no other run uses. Any `TEST_DATABASE_URL` must end in `_test`.
- The API gate was intermittently red because of the SIGTERM race in
  `test/sec-hardening.test.ts`. The test sent SIGTERM as soon as it saw the
  listen log, before `src/server.ts` had registered its handler. The handler is
  now registered before listen, in the same change as this ADR.
- A raised threshold makes the next pull request that lowers coverage fail.
  That is intended.
- `pytest-cov` is a new dev dependency in `services/engine`.

## Not done

- Branch coverage for the engine.
- Gating functions coverage.
- Per-file thresholds.
- Making the gates required in the live ruleset. `.github/rulesets/main.json`
  now names `lint`, `unit` and `engine`. The owner must apply it to the live
  repository.
- Coverage for files no test loads. Node's coverage only reports files that a
  test imports, so a new untested source file does not lower the percentage.
  The `.tsx` components in `apps/web` and the child-process entry point
  `src/server.ts` are not loaded by the unit tests, so they are invisible to
  this gate too. Closing this needs a test that imports every module, or a
  switch to a tool that reports unloaded files (for example c8 with `--all`).
- Helper files under `apps/api/test/` count towards the API numbers.
