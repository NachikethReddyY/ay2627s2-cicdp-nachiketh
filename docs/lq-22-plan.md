# LQ-22: BKT learner model and next-step policy (WP7)

Jira: https://nachikethsworkspace-45811689.atlassian.net/browse/LQ-22
Sprint 3 · 8 points · epic LQ-31 "API & learner data" · status: To Do

Story: per-learner, per-concept mastery, with a next-step recommendation and its reason.
Acceptance: P1–P3 Hypothesis tests green; each recommendation includes a reason.

Subtasks: LQ-84 (T1) to LQ-90 (T7).

---

## 0. Repo facts this plan relies on

**The spec already exists in `docs/plan.md`:**

- §8.2 (lines 234–267) sets the observation rules, update equations, parameters, P1–P3, thresholds and policy.
- WP7 (line 524) owns `services/engine/{bkt,policy}` and the routes `/v1/mastery/update` and `/v1/next`.
- Line 165 says to use Hypothesis for the P1–P3 tests.
- Engine request and response shapes are at lines 320–325.
- Tables `mastery` and `recommendations` are at lines 207–209.
- `docs/api-plan.md` T7 (lines 189–192) describes the API-side mastery worker.

**P1–P3 are defined** in `docs/plan.md` lines 252–255:

- **P1:** `p'` and `p_next` are always in [0, 1].
- **P2:** a correct observation never lowers `p'`; an incorrect one never raises it.
- **P3:** `p_next` can rise after a wrong answer because of the learn step. It also serves as a convergence check: with default MCQ settings, three correct answers from `p_init` 0.2 give 0.58 → 0.87 → 0.97.

**Nothing BKT-like exists yet:**

- `services/engine/bkt/` and `services/engine/policy/` contain only `.gitkeep`. They sit outside the packaged module; CI runs mypy on `learnquest_engine` only (`.github/workflows/ci.yml:67`).
- Hypothesis is not a dependency (`services/engine/pyproject.toml`, dev group).
- `apps/api/src/db/schema.ts` has no `mastery`, `recommendations` or `concept_edges` table.

**Gaps between the plan and the code:**

- `steps` has no concept column. Concepts are free text in `lessons.concepts` (schema.ts:251) and `StepSecret.concepts?` (schema.ts:287, AI lessons only).
- The `concepts` table (schema.ts:210–221) exists, but nothing writes to it. The seed creates none.
- Seeded `lesson-1` steps have no concepts (`apps/api/src/db/seed.ts:62–86`).
- pg-boss is not installed. There is no `worker/` directory.
- The `worlds/` manifest directory from plan §8.4 does not exist. `worlds.config jsonb` does (schema.ts:116).

**Hooks this story builds on:**

- Attempts already record `observed = (n === 0)` and `hintsUsed` inside a row-locked transaction (`apps/api/src/attempts/router.ts:76–110`).
- A partial unique index allows one observed row per (learner, step) (schema.ts:347–349).
- The engine client is `callEngine` (`apps/api/src/engine-client/client.ts:15`). Tests replace it through a seam object (`apps/api/src/engine-client/parts.ts:12`, used in `test/gen-ai.test.ts:63`).
- The engine checks its token with `Depends(require_token)` (`learnquest_engine/server.py:60`).
- API tests must use a database whose name ends in `_test` (`apps/api/test/helpers.ts:4–8`).

**Naming:** the story says `p_transit`; the plan says `p_learn`. This plan keeps `p_learn`, the transit probability.

---

## 1. Scope

**In scope**

- Pure-Python BKT update (constraints and clamping) and a next-step policy, each recommendation with a reason. In `learnquest_engine`.
- Two stateless engine routes: `/v1/mastery/update` and `/v1/next`.
- P1–P3 Hypothesis tests.
- API: `mastery` and `recommendations` tables; BKT updates from observed first actions on predict steps; read-only `me.mastery` and `me.next` procedures.

**Out of scope**

- Mastery list and recommendation card UI (WP17).
- pg-boss and the import job (WP8).
- `explanationStyle` and `skipOffered` on `steps.get` (WP5).
- Fitting parameters from data.
- Review scheduling (SM-2) and badges.
- Counting practice runs or game wins as observations.
- Defining the concept catalogue and prerequisite edges (AGENTS.md "Pending work" item 1).
- Reordering steps. Plan §8.2 keeps steps in commit order.

---

## 2. Where the code goes

**Engine (Python)**

- `learnquest_engine/bkt.py`: BKT update and parameter validation.
- `learnquest_engine/policy.py`: `recommend`, a pure function.
- `learnquest_engine/learner.py`: Pydantic request and response models (kept apart from the LLM ports in `schemas.py`).
- `learnquest_engine/server.py`: `POST /v1/mastery/update` and `POST /v1/next`, both with `Depends(require_token)`, no LLM call.
- Delete the empty `services/engine/{bkt,policy}/` directories.

**API (TypeScript)**

- `apps/api/src/progress/mastery.ts`: pure `observationOf`, `applyObservations`, and the procedures merged into `meRouter` (`progress/me.ts:35`).
- `apps/api/src/engine-client/learner.ts`: seam object `engineLearner = { update, next }`, Zod-parsed, same pattern as `parts.ts`.
- `apps/api/src/attempts/router.ts`: call `applyObservations` after `mutate()` commits (line 76).

**Schema (one migration, `0017_mastery.sql`)**

- `mastery(learner_id → learners ON DELETE CASCADE, concept_id → concepts, p_known real NOT NULL, n_obs int NOT NULL DEFAULT 0, updated_at, PK(learner_id, concept_id))`. `p_known` stores `p_next`, as plan line 208 does.
- `recommendations(id, learner_id → learners CASCADE, world_id → worlds, lesson_id → lessons NULL, concept_id → concepts NULL, action CHECK IN ('start','learn','practice','advance','done'), reason_code NOT NULL, reason NOT NULL, created_at)`, indexed on `(learner_id, world_id, created_at DESC)`.
- `attempts.mastery_applied_at timestamp NULL`: idempotency marker. Replaces the pg-boss singleton key.

**Concept identity:** on first use, concepts are upserted by `(world_id, slug)`, where slug is the lowercased, trimmed string. A step's concepts are `step.secret.concepts ?? lesson.concepts`. If both are empty, no observation is made and that is logged. Seed lesson-1 with concepts so the flow can be tested.

---

## 3. BKT

**Parameters**

| Parameter | Default |
|---|---|
| `p_init` | 0.2 |
| `p_learn` (transit) | 0.2 |
| `p_slip` | 0.1 |
| `p_guess`, MCQ | 0.25 (1 / 4 options) |
| `p_guess`, cloze | 0.10 |

Validation: `0 < p_slip < 0.5`, `0 < p_guess < 0.5`, `p_guess < 1 − p_slip` (this last one guarantees P2). Every probability is clamped to [0.001, 0.999]. Bad parameters give a 422.

**Update equations**

- correct: `p' = p(1−s) / [p(1−s) + (1−p)g]`
- incorrect: `p' = p·s / [p·s + (1−p)(1−g)]`
- learn step: `p_next = p' + (1−p')·p_learn`

**Mapping an attempt to an observation** (pure TypeScript, in the API):

- Clean correct first action → correct.
- Correct after any hint, wrong, or skipped as first action → incorrect.
- Any other action → no observation.

Every concept on the step receives the same observation.

**Thresholds**

- Unlock at `p_known ≥ 0.8` (plan line 258).
- **Mastered at `p_known ≥ 0.95`.** Not in the plan; proposed here (see §8, decision 1).

**Parameter source:** engine defaults are constants. The request's `params` field is optional, and the API sends `worlds.config.bkt` when present. Fitting from data is a later story (plan line 267).

---

## 4. Next-step policy

`recommend(mastery, edges, lessons, unlockAt=0.8, masteredAt=0.95)`, a pure function.

Rules, applied in order; first match wins:

1. **No observations in this world** → `start`. First unfinished lesson in course order.
   - Reason: "You haven't started {course} yet. This lesson introduces {concept}."
2. Among unlocked concepts (all prerequisites ≥ 0.8) below 0.95 that an unfinished lesson covers, take the lowest `p_known`; ties go to course order. A concept with no unfinished lesson left is never picked, so a reason never points at an unrelated lesson.
   - **p < 0.4** → `learn`. Prefer an unfinished learn or watch lesson covering the concept.
     - Reason: "{concept} is at {pct}%. A worked explanation comes first."
   - **0.4 ≤ p < 0.95** → `practice`. Prefer a predict, practice or game-practice lesson covering the concept.
     - Reason: "{concept} is at {pct}%. More practice will make it stick."
3. **Nothing left to practise** (no concept below 0.95 has an unfinished lesson) and a lesson remains → `advance`.
   - Reason: "You've mastered {list}. Next up: {lesson}." `{list}` names only concepts at or above 0.95, in course order.
4. **Nothing remains** → `done`, `lessonId` null.

Every output carries a `reasonCode` from a fixed enum and a learner-facing `reason`. A single function builds both, so no recommendation can be produced without a reason. The reason never mentions step content.

`POLICY_VERSION` is `4`, in both `policy.py` and `progress/mastery.ts`. Bump it whenever a rule or a reason changes. It is part of the recommendation cache hash, so stored recommendations are recomputed.

**Fit with the lesson mix:** the policy only chooses which lesson comes next. It does not touch step order, hints or answers. Hint depth stays with the attempt state machine (`attempts/machine.ts`). `explanationStyle` belongs to WP5.

---

## 5. API surface

**Engine (internal, token required)**

- `POST /v1/mastery/update`
  - Request: `{ priors: [{conceptId, pKnown | null}], params?, questionType: "mcq" | "cloze", correct }`
  - Response: `{ updates: [{conceptId, pPosterior, pNext}] }`
- `POST /v1/next`
  - Request: mastery, edges, lessons, thresholds (§4).
  - Response: `{ action, lessonId | null, conceptId | null, reasonCode, reason }`

**tRPC (protected)**

- `me.mastery({ world })` → `[{ conceptSlug, name, pKnown, nObs, mastered }]`
- `me.next({ world })` → `{ action, lessonSlug | null, lessonTitle | null, conceptSlug | null, reason } | null`
- Both use the existing `visibleWorld` check (`apps/api/src/access.ts`).
- **No public mutation.** Mastery changes only as a side effect of `steps.attempt` and `steps.skip`.
- **No answer keys.** Neither output includes `steps.secret`, hint text or expected output. A leak test covers this (T6).

**Write path without pg-boss**

1. After `mutate()` commits (`attempts/router.ts:76`), if the attempt was observed, call `applyObservations(learnerId)`. Errors are caught and logged; the attempt response never fails because of mastery.
2. `applyObservations` runs one transaction:
   - `SELECT … FROM learners WHERE id = $1 FOR NO KEY UPDATE`. It serialises calls per learner and does not block the locks that attempt inserts take.
   - Select observed attempts with `mastery_applied_at IS NULL`, limit 50.
   - For each: call the engine update, upsert `mastery` (`n_obs + 1`), set `mastery_applied_at`.
   - Call `/v1/next` and insert one `recommendations` row. Its lessons are the ones the course lists show: published lessons and AI drafts. A draft is never `done`.
   - Engine calls inside the transaction time out after 8 s (`ENGINE_CALL_TIMEOUT_MS`). That is below the 30 s `idle_in_transaction_session_timeout` in `db/client.ts`, which would otherwise close the transaction. The catch-up stops starting new rows or worlds after 12 s (`CATCH_UP_BUDGET_MS`). Rows left pending are applied by a later call.
3. `me.mastery` and `me.next` run `applyObservations` first, so an engine outage earlier is caught up on read.

---

## 6. Tasks

Each is one concern per PR. Jira subtask in brackets.

| # | Task | Files | Tests first | Done when | Order |
|---|---|---|---|---|---|
| T1 | BKT core and P1–P3 tests [LQ-84] | `pyproject.toml` (add `hypothesis>=6`), `uv.lock`, `learnquest_engine/bkt.py`, `tests/test_bkt.py`; delete `services/engine/{bkt,policy}/` | P1–P3 Hypothesis tests; worked numbers; bad parameters raise | ruff, mypy `--strict`, pytest green | starts first |
| T2 | Policy [LQ-85] | `learnquest_engine/policy.py`, `tests/test_policy.py` | one test per rule; tie-breaks; locked prerequisites skipped; every output has a reason (Hypothesis) | engine checks green | with T1 |
| T3 | Engine routes [LQ-86] | `learnquest_engine/learner.py`, `server.py`, `tests/test_learner_routes.py`, `services/engine/README.md` | 401 without token; 422 on bad parameters; shapes; no LLM call (`no_network`) | engine green; README lists routes | after T1, T2 |
| T4 | Schema, migration, seed [LQ-87] | `schema.ts`, `drizzle/0017_mastery.sql`, `seed.ts`, `test/helpers.ts` | migration applies on `_test`; learner delete cascades | `db:generate` clean | with T1–T3 |
| T5 | Observation mapping and apply [LQ-88] | `progress/mastery.ts`, `engine-client/learner.ts`, `attempts/router.ts`, `test/mastery.test.ts` | `observationOf` table test; clean correct raises; hint-assisted lowers; second attempt not observed; apply twice does not double `n_obs`; engine throws → attempt still 200, later read catches up; 20 parallel attempts → `n_obs = 1` | full turbo CI green | after T3, T4 |
| T6 | `me.mastery` / `me.next` [LQ-89] | `progress/me.ts`, `test/mastery.test.ts` | UNAUTHORIZED without session; private world 404; recommendation has reason; leak walk | full turbo CI green | after T5 |
| T7 | Docs [LQ-90] | `docs/plan.md` §8.2, `docs/api-plan.md` T7 | — | docs match what was built | with T6, after decisions confirmed |

Suggested PR grouping: T1+T2, T3, T4, T5, T6+T7 (about five PRs).

---

## 7. Test plan

**"P1–P3 Hypothesis tests green"** (`tests/test_bkt.py`). Strategies draw `p` from `st.floats(0, 1)` and `params` from valid ranges, using `assume(valid)`.

- **P1:** for any `p`, valid params and either observation, `0 ≤ p' ≤ 1` and `0 ≤ p_next ≤ 1`.
- **P2:** `posterior(p, correct=True) ≥ clamp(p)`; `posterior(p, correct=False) ≤ clamp(p)`.
- **P3, part 1:** a pinned example where a wrong answer raises `p_next` (`p = 0.2` gives 0.226).
- **P3, part 2:** default MCQ settings, three correct answers from 0.2 give `p_next ≥ 0.95`, with intermediates ≈ 0.579, 0.866, 0.967 (`pytest.approx`, abs 0.01).
- Extra property: `p_next ≥ p'` always.

**"Recommendation includes a reason"**

- `tests/test_policy.py`: Hypothesis property. For any valid input, `reason` is non-empty, `reasonCode` is in the enum, and `lessonId` is null only when action is `done`.
- `test/mastery.test.ts`: stored row and `me.next` output both carry a reason.

**Local CI (from AGENTS.md)**

```bash
TEST_DATABASE_URL=postgres://learnquest:learnquest@localhost:5432/learnquest_test \
  pnpm exec turbo run lint test build
cd services/engine && uv run ruff check learnquest_engine tests scripts \
  && uv run mypy --strict learnquest_engine && uv run pytest
```

---

## 8. Decisions needed (before T5 and T7)

1. **Mastered threshold.** Proposed 0.95, unlock at 0.8. This changes the learner model, so AGENTS.md requires asking first.
2. **pg-boss.** Proposed: dropped for this story, replaced by catch-up on read plus `attempts.mastery_applied_at`. This departs from plan §8.2 and api-plan T7.
3. **Concept identity.** Free-text concepts are upserted by slug. Risk: near-duplicates such as "loop" and "loops" split mastery.
4. **Prerequisites.** No edges yet, so every concept counts as unlocked.
5. **Observation scope.** Only predict steps feed BKT. Should checked practice runs or game wins count?
6. **Parameter name.** Keep `p_learn` (plan) rather than `p_transit` (story).

---

## 9. Risks

- Concept slugs drift without a catalogue, so mastery can split across near-duplicates (decision 3).
- Without prerequisite edges, the policy may recommend concepts a learner has not reached. Acceptable for the first cut only.
- `applyObservations` holds a row lock on the learner while it calls the engine (§5). Each call is capped at 8 s and the catch-up at 12 s, so the lock is held for seconds at most. If latency still shows up, compute the updates outside the lock and write them in a second step.
