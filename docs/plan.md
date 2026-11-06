# LearnSlop — Project Plan

> Status: **v2 final (2026-10-27), after 6 review passes.** WP0 (spikes) and WP1 (repo skeleton) may start now. Before Week 1 ends, answer Q3, Q5, Q8, Q9 and decide Rec-2 (§17). Every other open question has a working default.
> Changes from v1: 6-week core with a Wk-3 cut gate and an ordered cut line; adaptivity redefined (steps keep commit order); answers, hints and source served server-side only; World seam defined; one queue (pg-boss on Postgres); data model and API made consistent; KidsQuest, sandbox, embed and SDK publish moved to stretch (Appendix A).
> Date: 2026-10-27 · Owner: Nachikethreddyy · CICDP course project, solo, **6 weeks** (§11), deadline unknown (Q3).
> Source: `docs/idea.md`, `docs/notes/`.

---

## 1. The idea

**LearnSlop turns a real code change into an adaptive lesson: the learner predicts before being told, and the system models what they understand and adapts the next step.**

Core AI, stated plainly: (a) **generated lessons**: an LLM drafts a prediction, hints and explanations for each step, which the author reviews and publishes; (b) **adaptive choices**: explanation style (worked example / practice; the visual style is KidsQuest-only, stretch), hint depth, skip offer and next-lesson recommendation come from a learner model. **No free-chat tutor in core.**

Core loop: present a step → predict → hint ladder on a miss → reveal (replay + narration) → update the model → next step.

- From **Primer**: learner model, adaptive next step. Dropped: "solves the YC Primer" (the YC request is for ages 4–10 tutoring).
- From **Scrim-Forge**: editable replay from commit history, narration. Dropped: any-repo import, recorded keystrokes, O(1) scrub, "AI knows why the author wrote it" (§12).
- **Worlds:** CodeQuest is core. KidsQuest is stretch (Appendix A). A world is a plugin (§8.4).
- **"Video injection"** (assumption, Q1): narration and media cues on the replay timeline. Embed and MP4 are stretch or Won't.

---

## 2. Goals, non-goals, success criteria

**Goals**
- G1. A permissively licensed JS/TS commit becomes a replayable lesson with predictions, hints and narration.
- G2. A BKT learner model per account drives the next step.
- G3. A second world on the same engine. Core proves the seam with a CI fixture world; KidsQuest is stretch (Rec-1).
- G4. Model-agnostic AI: LiteLLM, one provider in core.
- G5. TS and Python SDKs (stretch). G6. CI/CD and one live URL. G7. SDLC artefacts.

**Non-goals:** any-repo or arbitrary-URL import; pull-request import (commit only); private repos; non-JS/TS content; real-time multi-user; payments; mobile; kids chat; calling the replay "recorded".

**Success criteria**
- S1: one permissive OSS commit (Q6) plays end to end in the **deployed** app by Wk 6. Agni is a local pilot only, never deployed (Q7).
- S2a (Wk 2, paper): 1–2 people write each step's change in their own words before reading the replay. **Pass: ≥ 2 of 3 steps stated correctly.**
- S2b (Wk 4): 3+ classmates, counterbalanced, two synthetic lessons with narration. Replay vs. reading the same diff, then a short quiz. Go on only if the replay group scores better or finds it clearly easier. Directional, not decisive, with ~3 people. Decision Fri Wk 5 (§11.2): if negative, Mon–Thu Wk 5 is one rework-and-rerun slot; if positive, that slot goes to stretch. Consent: Q12.
- S3: tokens and cost per generated lesson, from `llm_calls` (N/A if only fixtures ran).
- S4: CI green on every PR; `main` deploys; post-deploy smoke passes on staging and prod.
- S5 (stretch, Rec-1): KidsQuest with no change to engine core logic. Expected touched paths: `worlds/kidsquest/`, `services/engine/worlds/kidsquest.py`, `packages/ui-catalog/`, `apps/web/src/{kids,worlds/kidsquest}/`, `e2e/kids/`, one `WORLDS` entry, and the step-kind enum migration (§8.4). CI path check (WP14) flags anything else.

---

## 3. Users and use cases

Core actors: **learner (student or junior developer)**, author, admin.

| ID | Use case | Core |
|---|---|---|
| UC1 | Register / log in (email+password, GitHub) | yes |
| UC3–UC6 | Browse; play (replay, pause, edit); predict; request hints | yes |
| UC8–UC9 | Mastery list; next recommended lesson, with reason | yes |
| UC11 | Import a commit → draft lesson | yes (author) |
| UC12 | Publish / unpublish (editing: cut 6) | yes (author) |
| UC2, UC10 | Child profile with consent; KidsQuest challenge | stretch (App. A) |
| UC7, UC13–UC15 | Sandbox; provider config; SDK; embed | stretch (cuts 4, 5, 9, 11, 12) |

Full flows: `docs/sdlc/use-cases.md` (WP0).

---

## 4. Requirements

**Must** (= 6-week core, §11.1)
- FR1 Accounts: email+password, GitHub OAuth, sessions, roles author/admin/learner. No password reset.
- FR2 Import one allow-listed public commit with a licence check → `202 {jobId}`.
- FR3 Draft lesson: one step per hunk. One LLM call per lesson gives prediction, hints and explanations for every step. Schema-validated, with a deterministic fallback (§8.1).
- FR4 Player: bundled Monaco, play/pause/seek/speed, snapshots + deltas, pause-and-edit.
- FR5 Prediction gate, hint ladder, reveal gate (§5, §15.1). Attempts persisted. Hints and answers served server-side only.
- FR6 BKT per learner × concept; next-step recommendation with a reason.
- FR7 Narration: pre-rendered MP3 per step; browser speech fallback.
- FR10 CI/CD, one live URL. FR13a Author publish/unpublish. FR14a Mastery list.

**Should** (cut line, §11.3): FR3b LLM extras (12); FR7b live TTS (8); FR8 KidsQuest (10); FR9 SDKs (4, 11); FR11 sandbox (9); FR12 embed (5); FR13b author editing (6); FR14b quest, review, dashboard (7).
**Could:** FR16 local-model profile (Ollama); FR17 Prometheus/Grafana. **Won't:** FR15 MP4 export.

**Non-functional**
- NFR1 Kids safety: stretch only (Appendix A).
- NFR2 Security: argon2id; httpOnly secure cookies; CSRF; in-memory rate limits (single instance); secrets in env store; dependency, secret and image scans; code runs only in the browser.
- NFR3 Performance: seek replays ≤ K events (§8.3); first paint ≤ 2.5 s; generation is async.
- NFR4 Accessibility: WCAG 2.2 AA target; keyboard player control; captions from narration text (WP4 M2); axe in Playwright.
- NFR5 Reliability: LLM failure → fallback content; attempts are never lost.
- NFR6 Observability: JSON logs, request IDs, `/healthz`, `/readyz`, `llm_calls`.
- NFR7 Portability: runs locally with `docker compose` and no models (seeded lessons, pre-rendered audio). GitHub ingest needs network.
- NFR8 Maintainability: strict TS; mypy-strict engine; coverage gates (§15.10); ADRs.

---

## 5. Architecture

> **Status (2026-11-05):** Not built yet: the SSE endpoint, the pg-boss background worker and the `WORKER_IN_PROCESS` switch. `apps/api` has no pg-boss dependency. Lesson generation runs in-process on the request. The diagram below is the target design.

```
Browser: apps/web (React + Vite + TS): bundled Monaco, XState player, player-core, MP3 narration
   │ REST + SSE, same-site via Vercel rewrites
apps/api (Fastify + TS): auth, lessons, steps, attempts, hints, progress; pg-boss worker (in-process)
   │ HTTP/JSON (internal)                     │
services/engine (FastAPI + Py): ingest, pedagogy (LiteLLM), BKT, next-step policy
   └─ GitHub REST: engine only, allow-listed
PostgreSQL: state + pg-boss queue (Redis: not in core, Rec-2)
```

**Why this split**
- TypeScript owns web, API, persistence, auth, queue, player and T1/T2 grading.
- Python owns ingest, the pedagogy LLM call and BKT, because LiteLLM is Python-only. The Python SDK (stretch) exists for the polyglot requirement; its publish is cut 4.
- The engine is stateless: JSON in, JSON out, no DB writes. Callers pass state in.
- Contracts: Zod in `packages/lesson-schema` is the source. CI exports JSON Schema and checks shared JSON fixtures against Zod and hand-written Pydantic models.

**Patterns (report-worthy):** event sourcing with commands for the timeline; snapshot + delta replay (bounded, not O(1)); XState for player modes; transactional enqueue (the job is written in the same transaction as the attempt); ports and adapters for LLM, TTS and worlds.

**Player state machine.** Server-side step states live in `step_progress`. Lines marked *client* are client-only.
```
loading → ready → playing ⇄ paused                                      (client)
predicting --correct, first attempt-------------------> revealed
predicting --wrong, first attempt----------------------> hinting        (observed)
predicting|hinting --POST /hints (rung k)-------------> hinting        (sets attempt_allowed=true)
hinting --wrong, rungs left----------------------------> hinting        (attempt_allowed=false: next attempt needs a new rung, else 409)
hinting --wrong, last rung used------------------------> hinting        (sets retry_allowed=true: one retry)
hinting --wrong, retry_allowed-------------------------> revealed       (auto-reveal)
hinting --correct attempt------------------------------> revealed
predicting|hinting --POST /skip------------------------> skipped        (always available; reveal allowed)
revealed|skipped --> replay plays --> next step | finished              (replay: client)
attempts in revealed or skipped: 409
```

---

## 6. Stack

**6.1 Tooling:** pnpm workspaces; Node 22, strict, ESM; Python 3.12, `uv`, ruff, mypy --strict, pytest; ESLint + Prettier; pre-commit + commitlint; Dependabot only.

**6.2 Frontend:** React + Vite + TS · Monaco via `loader.config({ monaco })` with bundled `monaco-editor` (no CDN) · XState · TanStack Query · React Router · Tailwind + Radix · `diff-match-patch` (char diff in `player-core`) · DOMPurify · Jest + Testing Library (jsdom) + fast-check. **Worlds registry** is a generated file, `apps/web/src/worlds/registry.gen.ts`, written by `scripts/gen-registry.ts` before test and build. Jest works with no `import.meta.glob`.

**6.3 API:** Fastify 5 · Zod via `fastify-type-provider-zod` · `@fastify/swagger` · Drizzle + drizzle-kit · `pg` · argon2id (`@node-rs/argon2`) + cookie sessions · GitHub OAuth · **pg-boss** (queue on Postgres) · SSE via Postgres LISTEN/NOTIFY · pino · `@fastify/rate-limit` (in-memory) · helmet, cors, CSRF · `typescript` scanner for T2. The API holds no GitHub token.

**6.4 Engine:** FastAPI · Pydantic v2 (hand-written models) · `unidiff` · `httpx` (GitHub, read-only token) · BKT in pure Python · tenacity · structlog. **LiteLLM** in core: one provider (Anthropic), pedagogy only. Pin it; check LiteLLM advisories in WP0 (a compromised PyPI release was reported in 2026; verify). tree-sitter is not used.

**6.5 Data:** PostgreSQL 16+ (Neon or Supabase in cloud; compose locally). pg-boss uses the same database. Redis is not in core (Rec-2). Media: MP3s are static files in the Vercel build. Cloudflare R2 is stretch (sandbox snapshots).

**6.6 AI and media**

| Capability | Core | Stretch |
|---|---|---|
| Ingest | GitHub REST, engine only, allow-listed; licence and vendored check | — |
| Pedagogy | LiteLLM → Anthropic, one provider; Pydantic + Zod validation; one repair retry inside the engine; fallback | segmentation, other providers, evals, T3 judge, prompt registry, admin page (cut 12) |
| Narration | Pre-rendered MP3 per step (WP11 script). Cloud: ElevenLabs if the author has a key. Local: Kokoro, run by the author. Browser speech if the MP3 is missing | live TTS, other adapters (OpenAI-compatible), Piper (cut 8) |
| Generated UI, sandbox | — | OpenUI (cut 10); WebContainers, Sandpack fallback (cut 9) |

Details of the stretch items: Appendix A.

**6.7 SDKs (stretch, cuts 4, 11):** generated from the Fastify OpenAPI. Pure API clients; no World code. The engine's internal client is generated from the engine's OpenAPI and not published.

**6.8 Testing**

| Layer | Tooling |
|---|---|
| TS unit and component (web, player-core, lesson-schema, grading) | Jest + Testing Library + fast-check |
| API integration | Jest + SuperTest + Testcontainers (Postgres) |
| E2E | Playwright + axe. Wk-3 smoke in `e2e/smoke/` (WP4); PR e2e from Wk 5 (WP14) |
| Python | pytest; Hypothesis for BKT P1–P3; recorded LLM fixtures (no live calls in CI) |
| Contracts | shared JSON fixtures validated by Zod (TS) and Pydantic (engine) |
| Security | `pnpm audit`, `pip-audit`, gitleaks, Trivy |

**6.9 CI/CD and infrastructure**
- `pr.yml`: install → lint → unit (Jest, pytest) → API integration → build → Playwright e2e on `docker compose` → scans. `main.yml`: all of the above → GHCR images (SHA tag) → Vercel web deploy → Render api and engine → smoke (warm-up), staging then prod. WP1 owns root workflows; other WPs add reusable workflows (`workflow_call`) in `.github/workflows/jobs/`, called with `uses:` from `pr.yml` and `main.yml`.
- **Compose core services:** `postgres`, `api`, `engine`, `web` (Vite dev server). Stretch profiles: `redis`, `mailpit`. No web Docker image; Vercel hosts the web app.
- **Same-site routing:** Vercel rewrites `/api/*`, including SSE, to Render, so cookies are same-site. Risk: Vercel proxy timeouts on SSE, tested in Wk 1. Fallback: `app.` and `api.` subdomains (Q5).
- **Connection string:** pg-boss and LISTEN/NOTIFY need a direct or session-mode connection, not a transaction pooler. Neon and Supabase pooler URLs are transaction-mode by default.
- **Hosting (verify pricing in Wk 1):** Render free web services sleep (warm-up in smoke). The worker is not free, so pg-boss runs in the API process (`WORKER_IN_PROCESS=true`). Render's free Postgres has historically expired after ~30 days, so use Neon or Supabase.
- **Rollback:** promote the previous Vercel deployment; redeploy the previous SHA on Render. Smoke gates promotion.
- **Environments:** local (compose) → staging → prod. Previews, if any, use staging data only.

---

## 7. Data model (PostgreSQL 16+, Drizzle)

Principles: `steps` is the only home of step content. Published `lesson_versions` are immutable. Attempts reference `steps.id`. `steps.secret` is never returned by a read endpoint. Source (repo, SHA) is returned only with the reveal payload.

**Core tables**
```
users(id, email UNIQUE, password_hash null, role enum[learner,author,admin], created_at)
oauth_accounts(id, user_id→users, provider, provider_user_id, UNIQUE(provider, provider_user_id))
learners(id, kind enum[user], user_id→users UNIQUE)              -- child kind: stretch migration
sessions(id, user_id→users, active_learner_id→learners, token_hash UNIQUE, created_at, expires_at, revoked_at null)
worlds(id, slug UNIQUE, config jsonb)
concepts(id, world_id→worlds, slug, name, UNIQUE(world_id, slug))
concept_edges(from_concept_id→concepts, to_concept_id→concepts, PK(from_concept_id, to_concept_id))   -- prereq only
lessons(id, world_id→worlds, title, source_kind enum[repo,authored], source jsonb,
        status enum[draft,published,archived], current_version_id→lesson_versions null, created_by→users, created_at)
lesson_versions(id, lesson_id→lessons, version int, prompt_version null, created_at, published_at null, UNIQUE(lesson_id, version))
steps(id, lesson_version_id→lesson_versions, idx, public jsonb, secret jsonb, concept_ids text[], UNIQUE(lesson_version_id, idx))
  -- public {title, prompt, hintCount}; secret {beforeFiles, afterFiles, hunks, answer, accepted[], hints[], explanations{workedExample, practice}, source}
step_progress(learner_id→learners, step_id→steps, state enum[predicting,hinting,revealed,skipped],
        rungs_taken int, attempt_allowed bool, retry_allowed bool, updated_at, PK(learner_id, step_id))
attempts(id, learner_id→learners, step_id→steps, kind enum[mcq,cloze,skip], response jsonb null,
        observed bool, correct bool null, hints_used int, feedback jsonb null, missed_concepts text[],
        prompt_version null, created_at)
        -- kind=skip is the skip log. Partial unique index: one observed=true row per (learner_id, step_id)
hint_events(learner_id→learners, step_id→steps, rung int, created_at, PK(learner_id, step_id, rung))
lesson_jobs(id, type enum[import], status enum[queued,running,done,failed], progress int, error null,
        lesson_id null, created_by→users, created_at, updated_at)   -- UI status for imports only
mastery(learner_id→learners, concept_id→concepts, p_known real, n_obs int, updated_at, PK(learner_id, concept_id))
        -- p_known stores p_next (§8.2)
recommendations(id, learner_id→learners, lesson_id→lessons null, concept_id→concepts null, reason text, created_at)
media_assets(id, lesson_version_id→lesson_versions, step_id→steps null, storage_key, duration_ms, text_hash, provider)
llm_calls(id, lesson_job_id→lesson_jobs null, provider, model, purpose, prompt_version, tokens_in, tokens_out,
        latency_ms, cost_usd, validation_ok bool, created_at)
```
pg-boss keeps its own job tables. Mastery work is not in `lesson_jobs`.

**Stretch tables and columns** (added by their WP's migration): `child_profiles`, `parental_consents`, `review_schedule(learner_id, step_id)`, `badges(learner_id, badge_slug)`, `usage_quotas`, `provider_settings`, `lessons.embed_allowed_origins`, `learners.kind = child` with its check.

**Lesson response** (`GET /lessons/:id`): `{id, title, concepts[], steps:[{id, idx, title, conceptIds, hintCount, state}], labels:{reconstructed:true}}`. `state` is the active learner's `step_progress.state` (`predicting` if no row), so the player can resume in one call. No source, no file states, no prompts.

---

## 8. Key components

### 8.1 Lesson generation
Import (`POST /lessons/import`) → pg-boss job `import` in the API process:
1. Import body is `{repo, sha}`. The API rejects repos not in `worlds/codequest/repos.yml` (400); the engine resolves the parent SHA. `POST /v1/pipeline/ingest` (engine) fetches the commit. Checks licence and vendored code, and scans for secrets. Returns whole-file before/after per changed file and hunks. The engine applies hunks in order with `unidiff` to compute one `beforeFiles`/`afterFiles` state per step (WP6 deliverable, with a test). Commits over the §15.4 limits fail with `lesson_jobs.error = "split this lesson"`.
2. `POST /v1/pipeline/pedagogy` (engine, one call per lesson). The engine validates with Pydantic and does one repair retry with the validation errors appended. Validators reject output where any hint, title or explanation contains the normalised answer or an accepted variant, or where a concept slug is not in the manifest (both are validation errors). Returns the content, `usage` and `validation`.
3. The API re-validates with Zod, writes a draft `lesson_versions` and `steps`, and writes `llm_calls` from `usage`. The author publishes (UC12). Published versions are immutable.

**Fallback** (LLM off or invalid): synthetic lessons use hand-written content (WP11). The OSS lesson uses the LLM, with the deterministic fallback below. Imported lessons get a deterministic prediction. Cloze: one identifier or literal token of an added line with ≥ 3 tokens (§15.1). MCQ: the added line as the answer; distractors are drawn only from lines absent from the visible `beforeFiles` (added lines from other hunks, or mutated variants of the answer), so the answer is not the only absent option. Hints are generic (§15.1). The explanation is the commit title, labelled `inferred`.

Replay is built in `player-core` from hunks; no LLM is involved. Narration: `scripts/narrate.ts|py` (WP11) renders one MP3 per step into `apps/web/public/audio/<lesson>/`, run locally by the author. Narration plays on reveal; a missing MP3 falls back to browser speech.

### 8.2 Learner model and adaptivity (engine: `bkt`, `policy`)

**Scope.** Steps in a commit lesson are a fixed sequence (step N depends on the code after N−1), so they are never reordered. Adaptivity means explanation style, hint depth, skip offer, and next-lesson recommendation. KidsQuest's independent challenges can be reordered (stretch).

**Observations.** Only the **first action on a step** (attempt or skip) is observed. Later actions are logged, not observed. Each concept in the step's `conceptIds` gets the same observation.
- correct, 0 hints → correct
- correct after ≥ 1 hint → incorrect (hints earn no mastery credit)
- incorrect, or revealed without a correct attempt → incorrect
- skip as the first action → incorrect (the learner gave up before trying)
- skip after an attempt → no observation

**Update** (p = prior `p_known`, o = observation):
- correct: `p' = p(1−p_slip) / [p(1−p_slip) + (1−p)·p_guess]`
- incorrect: `p' = p·p_slip / [p·p_slip + (1−p)(1−p_guess)]`
- learn: `p_next = p' + (1−p')·p_learn`. **`p_next` is stored.**

**Parameters** (per world in `manifest.json`): `p_init`, `p_learn`, `p_slip`, `p_guess` per question type. Defaults: `p_init` 0.2, `p_learn` 0.2, `p_slip` 0.1, `p_guess` mcq 0.25, cloze 0.10. Constraints: `0 < p_slip < 0.5`, `0 < p_guess < 0.5`, `p_guess < 1 − p_slip`. All probabilities are clamped to [0.001, 0.999]. Validated at load and as the Hypothesis precondition.

**Properties (Hypothesis):**
- P1: `p'` and `p_next` ∈ [0, 1].
- P2: on `p'`, a correct observation never lowers it; an incorrect one never raises it.
- P3: `p_next` may rise after a wrong answer (learn step). By design. Test: default MCQ, 3 consecutive correct first-attempt observations from `p_init` give `p_next ≥ 0.95` (0.20 → 0.58 → 0.87 → 0.97).

**Thresholds** (one value each):
- Unlock: prerequisites at `p_known ≥ 0.8`.
- Failures on a concept = observed incorrect (including revealed). Hint-assisted successes do not count.
- Explanation style: `practice` if `floor(failures / 3)` is odd, else `worked_example`.
- `GET /steps/:id` returns `explanationStyle` and `skipOffered`, computed server-side from observed attempts (WP5, tested). Skip is always available (§9). `skipOffered` is display-only: it prompts the learner after ≥ 6 failures and does not gate skip.

**Policy:** between lessons, pick the lowest `p_known` among unlocked concepts and recommend the lesson that covers it, with `reason`. Stretch: review items before steps.

**Queue:** one DB transaction first locks the `step_progress` row (`SELECT … FOR UPDATE`), then writes the attempt, `step_progress`, hint rows, and a pg-boss job `mastery` (singleton key `mastery:<attemptId>`, so retries are idempotent). The response returns at once. The worker, in one transaction, locks the learner's `learners` row (`SELECT … FOR UPDATE`), calls `/v1/mastery/update` and `/v1/next`, and writes `mastery` and `recommendations`. The WK-1 spike confirms pg-boss can enqueue on the transaction's connection.

**Small data:** with ~3 code lessons, BKT barely moves. Report this as a limit.

### 8.3 Player core (`packages/player-core`)
- Events are derived from hunks. Same input and same typing config → same events. Config: hunks > 20 changed lines are inserted as one highlighted block; typing 60 WPM; 300 ms pause at line end.
- Snapshot every **K = 200** events and at every step boundary. `seek(t)` = nearest snapshot ≤ t, then replay.
- CI test: seek replays ≤ K events (count-based). The timing benchmark (≤ 100 ms at 5k events) runs locally and on release tags only.

### 8.4 World seam (WP2 defines it; this is its only home)
- A world is `worlds/<slug>/` at the repo root (`manifest.json`: concepts, edges, question types, BKT defaults; `prompts/`; `lessons/`), plus `services/engine/worlds/<slug>.py` (the Python World class), plus `apps/web/src/worlds/<slug>/` (TS renderers).
- `WORLDS` (env) lists the enabled worlds. The TS registry is generated (§6.2).
- CI runs `worlds/_fixture/` and `services/engine/worlds/_fixture.py` through the same seam. This keeps S5 honest without KidsQuest.
- Adding a world changes no engine-core logic, API core or `player-core`. KidsQuest's challenge steps add one value to the step-kind enum (stretch migration).

---

## 9. API surface (v1)

**Auth rules:** learners see published lessons only. Job events are visible to the creator only. `/me/*` uses `sessions.active_learner_id`. Author and admin endpoints check `users.role`.

**Public (core)**
- `POST /auth/register|login|logout` · `GET /auth/github` · `GET /auth/github/callback` (WP5)
- `GET /worlds` · `GET /worlds/:slug/concepts` · `GET /lessons?world=` (published only) · `GET /lessons/:id` (§7)
- `GET /steps/:id` → `{prompt, state, explanationStyle, skipOffered, beforeFiles | null}`. `beforeFiles` is returned only when the previous step is `revealed` or `skipped`, or for step 1.
- `POST /steps/:id/attempts` → `200 {attemptId, correct, feedback, missedConcepts, hintsUsed, state}`. `409` if the state is `revealed` or `skipped`, or if `hinting` with `attempt_allowed = false` (take the next rung first).
- `POST /steps/:id/hints` → `{rung, text, eliminate?}`. `eliminate` (MCQ rung 1 only) is the index of the distractor to cross out, picked by the API deterministically from the non-answer options (no schema change); never the answer. Allowed in `predicting` or `hinting`. `409` when all rungs are used.
- `POST /steps/:id/skip` → `{state:"skipped"}`. Always available until revealed. Writes an `attempts` row with `kind=skip`.
- `GET /steps/:id/reveal` → `{answer, hunks, explanations:{workedExample, practice, inferred:true}, source:{repo, sha, path}}`. `answer` is `{type:"mcq", index}` or `{type:"cloze", text}`, so the prompt can mark it. `409` unless the state is `revealed` or `skipped`.
- Narration MP3s are static files (`/audio/<lesson>/<step>.mp3`), not gated by the API. The client requests one only after reveal or skip (§12).
- `GET /me/progress` · `GET /me/next?world=` → `{lessonId, conceptId, reason}`
- `POST /lessons/import` (author; body `{repo, sha}`; repo not on the allow-list → 400) → `202 {jobId}` · `GET /jobs/:id/events` (SSE, creator only)
- `GET /author/lessons?status=draft` (author only) · `POST /lessons/:id/publish` · `POST /lessons/:id/unpublish` (author)

**Stretch:** `GET/PUT /admin/providers` (cut 12); child and embed endpoints (Appendix A); `GET /attempts/:id/events` for T3 (cut 12).

**Shapes (core)**
```
POST /steps/:id/attempts  body: {kind:"mcq", choice:0..3} | {kind:"cloze", text: string<=200}
                          (kind=skip is written only by POST /skip)
GET /steps/:id  prompt:  {type:"mcq", question, options[4]}
                         {type:"cloze", text:"const total = ____ + 1;"}   // exactly one "____"

POST /v1/pipeline/ingest        (engine)
  req: {repo, sha, parentSha}                        // repo must be in repos.yml
  res: {licence:{spdx,ok}, flags:{secrets[],vendored[]}, files:[{path,before,after}],
        hunks:[{id,file,lines[]}], stepStates:[{hunkId, beforeFiles, afterFiles}]}
POST /v1/pipeline/pedagogy      (engine; one call per lesson)
  req: {title, conceptSlugs[] (from manifest; the LLM picks only from these),
        hunks:[{id,file,lines[]}], promptVersion}
  res: {steps:[{hunkId, title,
                prediction: {type:"mcq", question, options[4], answerIndex}
                          | {type:"cloze", text, answer, accepted[]},
                hints[3] (2 for mcq), explanations:{workedExample, practice}, conceptSlugs[]}],
        usage:{model, tokensIn, tokensOut, latencyMs}, validation:{ok, errors[]}}
POST /v1/mastery/update         (engine; stateless)
  req: {priors:[{conceptId,pKnown}], params:{pInit,pLearn,pSlip,pGuess}, questionType, correct, conceptIds[]}
  res: {updates:[{conceptId, pPosterior, pNext}]}
POST /v1/next                   (engine; stateless)
  req: {world, mastery:[{conceptId,pKnown}], edges:[[from,to]], unlockAt:0.8, lessons:[{lessonId,conceptIds[]}]}
  res: {lessonId, conceptId, reason}
GET /healthz · GET /readyz
```
Stretch engine endpoints: `/v1/pipeline/segment`, `/v1/narrate`, `/v1/grade`.

---

## 10. Repository layout

```
apps/web/        src/{shell,player,author,quest,worlds}/ (core); src/{sandbox,kids}/ (stretch); scripts/gen-registry.ts; public/audio/
apps/api/        src/{auth,lessons,attempts,progress,grading,worker,sse,engine-client,db}/; drizzle/; test/security/
services/engine/ app.py (WP2); ingest/, pipeline/, llm/, bkt/, policy/, worlds/ (§8.4); snapshot/ (WP12); prompts/, evals/ (WP18)
packages/        lesson-schema/, player-core/ (core); ui-catalog/, sdk-ts/, sdk-py/, embed/ (stretch)
worlds/          codequest/ (manifest.json, prompts/, lessons/, repos.yml); _fixture/ (manifest.json)
e2e/             smoke/ (WP4); the rest (WP14); kids/ (stretch)
spikes/          throwaway (WP0)
infra/           docker/, render/, vercel/; k8s/ (stretch)
.github/workflows/  pr.yml, main.yml, release.yml (WP1); jobs/ (reusable `workflow_call`, others); k8s.yml (stretch)
docker-compose.yml  postgres, api, engine, web
docs/            idea.md, notes/ (existing); sdlc/; adr/; study/
plan.md  README.md
```

---

## 11. Delivery plan (6 weeks, solo)

### 11.1 The 6-week core (Must)
- **Lessons:** two synthetic lessons (ours, MIT), one OSS commit (Q6), deployed. Agni is a local pilot only. Lessons live in `worlds/codequest/lessons/*.json`, loaded by a seed script.
- **Generation:** ingest, pedagogy with recorded fixtures in CI, fallback (§8.1).
- **Play:** replay, prediction gate, hint ladder, reveal gate, mastery list. Accounts and attempts persisted.
- **Grading and learning:** T1/T2 in TS; BKT and policy in the engine, through the queue.
- **Narration:** MP3 per step. Synthetic lesson 1 in Wk 3, lesson 2 in Wk 4, OSS in Wk 5. Browser speech fallback.
- **Delivery:** CI/CD, PR e2e, staging, one live URL.
- **SDLC:** requirements and use cases (Wk 2); threat-model draft (Wk 2, ½ day); ADRs as decisions land; privacy notice, one paragraph (Wk 6); final threat model (Wk 6).

**Load check:** at most two core build WPs per week. Buffer days: Wk 3 Thursday and Wk 6 Friday. Report: ½ day in Wk 4, 5 and 6.

### 11.2 Weeks

| Wk | Core build WPs (≤ 2) | Exit / gate |
|---|---|---|
| **1** | WP1 skeleton (compose: postgres, api, engine, web). WP2 schema, World seam, engine bootstrap. WP0 spike (½ day): pg-boss transactional enqueue; Vercel SSE rewrite; hosting pricing; ADR 001 | CI green; queue confirmed; Q3, Q8, Q9 answered or defaulted |
| **2** | WP3 player-core. WP4-M1 (bundled Monaco, synthetic lesson 1, read-only diff page for the S2b control arm, no API). WP16 T1/T2 functions (pure, small). Threat-model draft by WP0 (½ day, Fri pm) | Replay runs in browser. **S2a (Fri, paper): pass ≥ 2 of 3 steps** |
| **3** | WP5 (auth, attempts, hints, skip, reveal, `explanationStyle`/`skipOffered`; uses WP16 functions). WP4-M2 (state machine, gate, ladder, reveal) + smoke in `e2e/smoke/`. WP11 synthetic lessons 1–2; narration for lesson 1. ADR 002. **Thu: buffer day** | **Cut gate (Fri)** |
| **4** | WP6 (ingest, pedagogy with fixtures). WP7 (BKT, policy). WP8 mastery worker (small). WP11 picks the OSS commit (Q6); narration for lesson 2. ADR 003. **S2b: Wed half-day, off the critical path** | Pedagogy validates on fixtures; BKT P1–P3 green; S2b run |
| **5** | WP8 (import SSE, publish, recommendation). WP17 (mastery list and next-lesson recommendation card, small). WP13 staging. PR e2e and axe config (WP14, small). WP11 OSS lesson and MP3s. Mon–Thu: rework-and-rerun slot only if the Wk-4 S2b result is negative | **S2b decision (Fri)**; staging smoke green |
| **6** | WP13 prod and S4 smoke. WP14 finish. WP15 final threat model and privacy paragraph (½ day). Report (½ day). Demo rehearsal (timed, 5 min). **Fri: buffer day** | S4; S1 on prod; report |

**Cut gate (Fri, Wk 3):** pass only if gate, hints, reveal and persisted attempts work end to end on synthetic lesson 1 in compose, T1/T2 works, and `main` CI is green. If it fails, no stretch item starts, and the named core fallbacks apply first: browser speech, polling instead of SSE, deterministic-only OSS lesson (§11.3). Rec-1 governs stretch items only, never core scope. If the core still overruns, the owner decides at this gate.

**S2b decision (Fri, Wk 5):** if the Wk-4 result is negative (replay group not better or clearly easier), Mon–Thu of Wk 5 is one rework round (pacing, chunking, narration) and a rerun with the same two lessons. Then decide the stretch cut. If the result is positive, that slot goes to stretch. No third round. Report either way.

### 11.3 Cut line

**One rule:** list order is cut order. The top item is cut first. Stretch items start only if the Wk-3 gate passes with time left, in reverse list order (most valuable first). The earliest-week column is a floor.

| # | Item | WP | Earliest |
|---|---|---|---|
| 1 | OpenTelemetry, Langfuse | WP13 | Wk 6 |
| 2 | k6, mutation testing, Schemathesis, OpenAPI diff | WP14 | Wk 6 |
| 3 | K8s manifests, kind job | WP13 | Wk 6 |
| 4 | Python SDK publish (generated client stays) | WP9 | Wk 6 |
| 5 | Embed widget (App. A) | WP12 | Wk 5 |
| 6 | Author editing beyond publish/unpublish | WP8 | Wk 5 |
| 7 | Quest and review extras, parent dashboard, badges, placement quiz | WP17 | Wk 6 |
| 8 | Live TTS, extra adapters, Piper (separate GPL container) | WP11 | Wk 5 |
| 9 | Sandbox fork (App. A) | WP12 | Wk 6 |
| 10 | KidsQuest (App. A) | WP10 | after Wk 6 (Rec-1) |
| 11 | TS SDK client and publish | WP9 | after Wk 6 (Rec-1) |
| 12 | LLM beyond pedagogy: segmentation, evals, T3 judge, prompt registry, provider admin page, other LLM providers, TTS adapters | WP6, WP16, WP18, WP5 | Wk 5 |

Already dropped: MinIO (filesystem locally, R2 in cloud). MP4 export is Won't.

**Core fallbacks** (used before cutting core scope; each has a named trigger):
- Browser speech for all narration. Trigger: MP3 pipeline not working by Wk 5 Fri.
- Polling instead of SSE for import progress. Trigger: Vercel SSE spike fails (Wk 1), or SSE unstable in Wk 5.
- Deterministic generation only (no LLM) for the OSS lesson. Trigger: pedagogy fails validation on the OSS lesson after one repair, in Wk 5.
- Synthetic-only deployed S1, with owner sign-off. Trigger: no OSS commit chosen by Fri Wk 4.

**Never cut:** prediction, hint and reveal gates; BKT; persisted attempts; T1/T2; pedagogy with fallback; narration for core lessons; CI/CD; unit and API tests; one e2e; the S1 deployed lesson (OSS, or synthetic with owner sign-off); S2a and S2b; one live URL.

---

## 12. Honesty labels (single home)

- Replays are **reconstructed from a diff**, not recorded. Badge: "Reconstructed replay".
- AI explanations of *why* the author wrote something are **inferred**. Label them.
- Seeking is bounded by snapshot spacing (K), not O(1).
- **The step gate is friction, not a security boundary.** The commit is public, so the answer can be read from git. Its purpose is learning, not secrecy. The same holds for narration MP3s: they are static files that anyone can fetch, and the player simply does not request one before reveal.
- Evidence supports "attempt before answer" but does not test this product. S2 tests it, weakly.
- Competitors (Scrimba, DeepWiki, Code Wiki, Pocket Flow, CodeTour): the gap is in search, not proof that nobody built it.

---

## 13. Risks

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Scope vs. 6 weeks solo | H | H | Core (§11.1), gates, cut line (§11.3) |
| R2 | OpenUI maturity (stretch) | M | M | Spike in KidsQuest week; JSON-UI fallback (App. A) |
| R3 | LLM output invalid or leaky | H | M | Pydantic + Zod validation; one repair; fallback; answers never sent before reveal |
| R4 | LLM cost and latency | M | M | One provider; one call per lesson; fixtures in CI; `llm_calls`; provider spend limit (Q4) |
| R5 | WebContainers licence and COOP/COEP | M | M | Stretch (cut 9); isolation on sandbox route only |
| R6 | Running untrusted repo code | M | H | Allow-list; browser-only execution |
| R7 | Children's data and safety | L | H | KidsQuest is stretch; consent first (App. A) |
| R8 | Repo licences, vendored code | M | M | Permissive gate; vendored scan; manual review |
| R9 | Learners "watch instead of learn" | M | H | Prediction gate; hints; reveal gate; S2 |
| R10 | Contract drift TS ↔ Py | M | M | Zod source; shared fixtures in CI |
| R11 | Free-tier limits (sleep, Postgres expiry, paid worker) | H | M | Pricing check Wk 1; worker in API; Neon or Supabase; warm-up |
| R12 | Secrets leakage | L | H | Env store; read-only GitHub token; gitleaks |
| R13 | Supply chain (reported compromised LiteLLM PyPI release; verify) | M | H | Hash-locked deps; advisory check before pinning; audits |
| R14 | Small data: BKT barely moves | H | M | Say so in the report (§8.2) |
| R15 | Study ethics and classmate data | M | M | Consent form; quiz score and time only; Q12 |
| R16 | Core overruns before the Wk-3 gate | M | H | Gate; cut line; Rec-1 |

---

## 14. Feasibility

- **Technical:** feasible; all components are mainstream. Highest risks: LLM quality (fallback and fixtures) and solo scope (gate).
- **Economic:** core runs on free tiers (pricing check Wk 1). The recurring cost is one LLM call per lesson, generated once and cached. S3 measures it.
- **Operational:** single developer; compose matches prod; automated deploys. Six weeks, with gates at Wk 3 and Wk 5.

---

## 15. Deep dive

**15.1 Grading and hints (single home for both rules)**
- **T1** MCQ: deterministic, TS (`apps/api/src/grading`). **T2** cloze: deterministic, TS, whitespace- and comment-insensitive token compare via the `typescript` scanner, with an accepted-variants list. **T3** (stretch, cut 12): engine judge, `pending` until the job completes.
- **Cloze rule:** blank exactly one identifier or literal on an added line with ≥ 3 tokens. Never punctuation or keywords. `text` is the full line with the blank shown as `____`.
- **Hint ladder:** MCQ has 2 rungs (rung 1 eliminates a distractor; rung 2 is the worked example). Cloze has 3 rungs. Rung 1 is allowed from `predicting`; each later rung comes from `hinting`. One attempt per rung. After the last rung, a wrong attempt sets `retry_allowed`; one more wrong attempt reveals. A correct answer after any hint is an incorrect observation (§8.2).
- The grader never sees other learners' data. Feedback never reveals an answer above the current rung.

**15.2 Learner model.** Wheel-spinning and style rules: §8.2 only. Stretch: SM-2-lite review over `review_schedule`, re-asking missed questions (cut 7). Each recommendation stores `reason`, shown in the UI.

**15.3 Quest layer (stretch, cut 7).** The mastery list is core. XP is derived from mastery gains and not stored, so watching earns nothing. Badges are `badges(learner_id, badge_slug)`. Children get no streaks, leaderboards, or loss aversion (App. A).

**15.4 Replay realism.** Char-level diff within each hunk (`diff-match-patch`), a typing cadence model, speeds 0.5×–4× with an "instant" mode, and file switches as explicit events. Limits per lesson: ≤ 8 files, ≤ 400 changed lines, no lockfiles or generated or binary files. Replay plays only after reveal (`revealed` or `skipped`). Pause-edits are a local overlay, discarded on resume after a prompt. Fork is stretch.

**15.5 Security (adds to NFR2)**

| Threat | Mitigation |
|---|---|
| Prompt injection via commit text | Repo text is fenced data; LLM calls have no tools; output schema-validated; URLs and HTML stripped; injection cases in tests |
| Answer leakage | `steps.secret` never returned; hints one rung at a time; `source` only in reveal; reveal gated; leak tests (WP5, reviewed by WP15). Honesty: §12 |
| XSS | Text rendering; DOMPurify; strict CSP; no `dangerouslySetInnerHTML` |
| SSRF on import | Engine is the only GitHub client; two hosts only; `repos.yml` allow-list |
| Secrets in imported code | gitleaks at ingest; flagged lessons blocked |
| Licence and vendored code | §8.1 and §15.8 |
| Auth and roles | argon2id; session rotation; CSRF; httpOnly + Secure + SameSite cookies; role checks (§9) |
| Cost and DoS | Job concurrency limit; per-user rate limit; max tokens |
| Supply chain | Hash-locked deps; LiteLLM advisory check in WP0 (verify the reported PyPI incident); Dependabot; `pip-audit`, `pnpm audit`, Trivy |

Threat model: STRIDE in `docs/sdlc/threat-model.md`. Draft by WP0 in Wk 2; final by WP15 in Wk 6.

**15.6 Privacy.** Core collects email and password (or GitHub identity) only. Privacy notice: one paragraph in `docs/sdlc/privacy.md` (Wk 6). Children and consent: Appendix A.

**15.7 AI practice.** Core: recorded fixtures only in CI; no live calls in PR checks; `prompt_version` on steps and `llm_calls`; repair inside the engine. Stretch (cut 12): prompt registry, provider failover, live evals with spend cap.

**15.8 Content.** CodeQuest core: two synthetic lessons (ours, MIT); one OSS commit (Q6: permissive, 3–8 hunks, has a test, ≤ 10 min to read, no vendored code); Agni, local pilot only, gitignored (Q7). Synthetic lessons: hand-written prediction, hints and explanations per step. OSS lesson: LLM-generated, with the deterministic fallback. Every step has an MP3. Author checklist: every question answerable from context; hints escalate; explanations labelled `inferred`; attribution present.

**15.9 Process.** Weekly notes, a GitHub Projects board, small PRs, ADRs for major decisions, and a self-review checklist. Definition of done: code, tests, docs, CI green, deployed to staging. Optional report evidence: DORA metrics and burndown from Actions and the board.

**15.10 Hardening**
- Migrations: expand/contract, pre-deploy job, tested on seed data. Published `lesson_versions` are never rewritten.
- Environments: `staging`, `production`. The production reviewer rule applies once the repo is public (Q8).
- Flags: `WORLDS` (the only world switch), `LIVE_LLM` (off = recorded fixtures or fallback, never a live call), `WORKER_IN_PROCESS`. Stretch: `SANDBOX_FORK`.
- Secrets, never in the repo: `DATABASE_URL` (direct connection), `SESSION_SECRET`, `GITHUB_TOKEN` (read-only), OAuth client secret, LLM key. GitHub Actions: `VERCEL_TOKEN`, Render deploy-hook URL. Stretch: `RESEND_API_KEY`, `EMBED_TOKEN_SECRET`, TTS key.
- Spend cap: the provider console's monthly limit, set at Q4. `usage_quotas` is stretch.
- Pinning: `uv lock` with hashes; pnpm lockfile.
- Coverage: ≥ 80% on `player-core`, `lesson-schema`, BKT; ≥ 70% elsewhere.

**15.11 UX (core).** Sign-in, lesson list, lesson player (editor, timeline, step panel, narration), prediction and hint panel, reveal, mastery list, next-lesson recommendation card with its reason (WP17, Wk 5), author publish list. Keyboard: space, ←/→, `h`. Reduced motion; captions and transcript; loading, empty and error states.

**15.12 Report, demo, study.** Report outline: problem and scope → requirements and use cases → feasibility → architecture → implementation → testing → CI/CD → risks → evaluation → reflection.
Demo script (5 min): import commit → lesson → play, predict, miss, hint, reveal → mastery list → next recommendation with reason → live URL → pipeline run.
Study design: §2 (S2a, S2b). Protocol, consent form and results in `docs/study/` (WP14).

---

## 16. Work packages

**Ground rules:**
1. Read `plan.md`. Stay inside your owned paths. Request contract changes from the owner (WP2 for schema and engine bootstrap; WP5 for the API).
2. Tests and lint pass before a WP finishes. Conventional Commits; small PRs (trunk-based); no secrets; no unrequested dependencies.
3. Root lockfiles and root CI files change only through WP1 or an explicit small PR.
4. If a spike contradicts the plan, write an ADR and stop to report.

| WP | Name | Owns | Depends on | Acceptance |
|---|---|---|---|---|
| **WP0** | Spikes, SDLC docs, ADRs | `docs/sdlc/` (threat-model draft, Wk 2; privacy: WP15), `docs/adr/`, `spikes/` | – | Wk 1: pg-boss transactional enqueue; Vercel SSE rewrite; hosting pricing; LiteLLM advisory check. Threat-model draft Wk 2. Later ADRs as decisions land |
| **WP1** | Monorepo, CI, compose | root config, lockfiles, `pr.yml`, `main.yml`, `release.yml`, `docker-compose.yml`, `infra/docker`, Dependabot | – | `pnpm test`, `uv run pytest`, `docker compose up` (postgres, api, engine, web; placeholder api, engine and web apps with health endpoints only, so compose runs in Wk 1); CI green; CodeQL on; non-root multi-stage images in `infra/docker`; repo public (MIT, synthetic only) |
| **WP2** | `lesson-schema`, World seam, engine bootstrap | `packages/lesson-schema`; `services/engine/app.py`, `services/engine/worlds/{base.py,_fixture.py}`; `worlds/_fixture/` | WP1 | Zod schemas (code step; public/secret; source union); JSON Schema export; shared fixtures; FastAPI app factory and Pydantic models; World protocol; fixture world loaded in CI |
| **WP3** | `player-core` | `packages/player-core` | WP2 | Events from hunks; reducer; snapshots every K=200 and at step boundaries; `seek`; CI bound test; fast-check property: `seek(t)` after play equals state at t; timing benchmark run locally and on tags |
| **WP4** | Web shell and player | `apps/web/src/{shell,player}`, `apps/web/src/worlds/codequest`, `scripts/gen-registry.ts`, `apps/web/src/worlds/registry.gen.ts`, `e2e/smoke/` | WP2, WP3; M2 needs WP5 | M1 (Wk 2): bundled Monaco (`loader.config`, no CDN) replays synthetic lesson 1; read-only diff page (S2b control arm). M2 (Wk 3): state machine, gate, ladder, reveal, keyboard, captions from narration text; smoke in `e2e/smoke/`; axe |
| **WP5** | API, auth, attempts | `apps/api/src/{auth,lessons,attempts,progress,db}`, `apps/api/drizzle/`, `apps/api/test/` (except `security/`, WP15) | WP1, WP2, WP16 | Fastify bootstrap; GitHub OAuth; login lockout/backoff; §7 core tables; `GET /steps` with `beforeFiles`, `explanationStyle`, `skipOffered` (tested); attempt, hint, skip and reveal rules; answer-leak tests (`GET /steps`, reveal gating, `source` only on reveal); SuperTest |
| **WP6** | Engine: ingest and pedagogy | `services/engine/{ingest,pipeline,llm}`, `services/engine/worlds/codequest.py` | WP2 | Ingest with allow-list, licence, vendored and secret checks, and `stepStates` via `unidiff` (tested); pedagogy with LiteLLM, Pydantic validation, one repair, `usage`; fallback; fixtures; leak test: all MCQ options are absent from the visible `beforeFiles` |
| **WP7** | Engine: learner model | `services/engine/{bkt,policy}` | WP2 | BKT with constraints and clamping; P1–P3 (P3 is the convergence check); `/v1/mastery/update`, `/v1/next` (stateless) |
| **WP8** | Job workers, SSE, publish | `apps/api/src/{worker,sse,engine-client}`, `apps/web/src/author` | WP5, WP6, WP7 | Mastery worker (learner row lock; idempotent); import job with SSE (creator only); recommendation with reason; publish and unpublish. Stretch: editing (cut 6) |
| **WP9** | SDKs (stretch) | `packages/sdk-ts`, `packages/sdk-py` | WP5 | Generated clients; publish is cuts 4 and 11 |
| **WP10** | KidsQuest (stretch, Rec-1) | `worlds/kidsquest/`, `packages/ui-catalog`, `apps/web/src/{kids,worlds/kidsquest}`, `e2e/kids/` | WP2, WP4, WP6, WP7 | Appendix A; no engine-core change (S5); parent data export and delete, retention |
| **WP11** | CodeQuest content | `worlds/codequest/{manifest.json,prompts/,lessons/,repos.yml}`, seed script, `scripts/narrate.ts\|py`, `apps/web/public/audio/` | WP2 | Synthetic lessons 1–2 hand-written (Wk 2–3); OSS lesson LLM-generated with deterministic fallback (Wk 4–5); answers in `secret`; `narrate` renders one MP3 per step |
| **WP12** | Sandbox and embed (stretch) | `apps/web/src/sandbox/`, `packages/embed`, `services/engine/snapshot`, `apps/api/src/embed` | WP4, WP5, WP6 | Appendix A |
| **WP13** | Deployment | `infra/{render,vercel}`, `.github/workflows/jobs/deploy.yml`; stretch: `infra/k8s`, `k8s.yml`, OTel | WP1, WP4, WP5, WP6, WP7 | GHCR images; Vercel static web and rewrites; Render api and engine with in-process worker; staging (Wk 5), prod (Wk 6); smoke |
| **WP14** | QA | `e2e/` (except `smoke/`), `docs/study/`; stretch: k6, mutation, Schemathesis | WP4, WP8 | PR e2e on compose from Wk 5; axe; coverage gates; study protocol, consent form, results template |
| **WP15** | Security and privacy | `docs/sdlc/threat-model.md` (final), `docs/sdlc/privacy.md`, `apps/api/test/security/` | WP5, WP6 | Final STRIDE threat model (Wk 6, from WP0's draft); privacy paragraph (Wk 6); SSRF tests; final review of WP5 answer-leak tests |
| **WP16** | Grader | `apps/api/src/grading` (T1/T2); stretch: `services/engine/grading` (T3) | – | T1 and T2 as pure TS functions with no DB dependency (WP5 imports them); accepted-variant lists; adversarial tests |
| **WP17** | Progress UX | `apps/web/src/quest` | WP4, WP5, WP7 | Core (Wk 5): mastery list and next-lesson recommendation card with reason. Stretch (cut 7): map, XP, badges, review, dashboard |
| **WP18** | Prompt registry and evals (stretch, cut 12) | `services/engine/{prompts,evals}` | WP6 | Versioned prompts; offline golden evals; capability matrix |

**Start rule:** a WP starts when its dependencies merge. §11.2 is the schedule.

---

## 17. Decisions locked in / still open

**Locked (from planning Q&A):**
- Merge both ideas as *one engine, two worlds*; code world first, kids world thin.
- React + Vite + Monaco, XState, Fastify, PostgreSQL, Jest/SuperTest/Playwright, ESLint/Prettier, CI/CD; Python for engine and SDK; TS and Python SDKs.
- Model-agnostic AI and TTS (OpenAI-compatible, Anthropic, local; ElevenLabs, local, others).
- Accounts and Postgres progress; WebContainers sandbox and TTS voiceover in scope (sandbox as should-have).
- Docker, Kubernetes, Redis, Vercel + Render.
- OpenUI / Open Intelligent UI as generative-UI direction; video-like timeline per `idea.md`.
- Graded: CI/CD, automated testing, SDLC docs, live demo. Solo, **6 weeks**.

Locked items placed behind the cut line (none removed): K8s (3); Python SDK publish (4); TS SDK (11); live TTS (8); sandbox (9); KidsQuest and OpenUI (10); LLM beyond pedagogy (12). Redis is an optional profile, not core (Rec-2).

**Open: owner decisions.** Each has a default the plan works with. "Blocks" is the week the real answer is needed.

| # | Question | Blocks | Default |
|---|---|---|---|
| Q1 | Confirm "video injection" (§1). | Wk 4 | As written |
| Q2 | KidsQuest age band (7–9); parent dashboard graded? | Wk 6, only if item 10 approved | Ages 7–9; not graded separately |
| Q3 | Deadline and marking rubric. | Wk 1 | 6 weeks. If sooner, cut top-first per §11.3; if later, no change |
| Q4 | Anthropic key for pedagogy; spend cap. | Wk 4 | If a key exists: author runs pedagogy once to record fixtures; CI uses fixtures only. No key at all: OSS lesson uses the deterministic fallback (§11.3). Cap: provider console limit, suggested $20 |
| Q5 | Accounts: Vercel, Render, Neon or Supabase, GHCR. Domain. | Wk 1 | No custom domain: Vercel rewrites to Render. Free tiers. Pooler-free connection string |
| Q6 | One permissive OSS commit for S1. | Wk 4 | Pick by Fri Wk 4. If none qualifies: synthetic-only deployed S1, with owner sign-off (§11.3 fallbacks) |
| Q7 | Is Agni public, and under what licence? | none | Local pilot only; gitignored; never deployed |
| Q8 | Repo public, and under what licence? | Wk 1 | Public from Wk 1, MIT, synthetic content, no secrets, no Agni. Branch protection and reviewers apply once public |
| Q9 | Does the course grade a team process? | Wk 1 | Light process (§15.9) |
| Q10 | Quest layer in graded MVP? | Wk 5 | Stretch (cut 7); mastery list stays |
| Q11 | GPU or Apple-silicon machine? | none | Not needed |
| Q12 | Ethics approval and consent for classmate studies? | Wk 2 | Written consent form for S2a and S2b; quiz score and time only; confirm course rules before S2b |

**Blocking summary:** Wk 1: Q3, Q5, Q8, Q9. Wk 2: Q12. Wk 4: Q1, Q4, Q6. Wk 5: Q10. Q2 only if item 10 is approved. Q7 and Q11 need nothing.

**Recommendations (needs owner OK):**
- **Rec-1: demote if the core overruns.** If the Wk-3 gate fails or Wk 5 finds the core behind, approve dropping cut items 8, 9, 10 and 11 (live TTS, sandbox, KidsQuest, TS SDK) from the plan of record. They stay listed as stretch and are not scheduled. Rec-1 covers stretch items only; core fallbacks (§11.3) are used first.
- **Rec-2: queue and Redis.** pg-boss replaces BullMQ, which removes Redis from core. Redis stays as an optional compose profile, used only if rate limiting or cache needs more than one instance. Needs owner OK because it moves a locked item.
- **Rec-3: JSON-UI instead of OpenUI** if the OpenUI spike fails in the KidsQuest week. Stretch only.

---

## Appendix A: Stretch designs (condensed)

- **KidsQuest (item 10):** 5 concepts × 3 challenges from `packages/ui-catalog`. OpenUI output is parsed and allow-listed in TS, both in the web renderer and in the API on save. JSON-UI fallback validated by Zod. Text ≤ 80 chars, from pre-approved story templates; the author approves each challenge; moderation by the OpenAI endpoint if a key exists, else a wordlist. Keyboard alternative for `DragToPartition`. No free text to any model. Audio-first, icon-led UI for early readers (ages 7–9). Parent dashboard is WP17. Consent: parent verifies email (Resend; Mailpit in dev), then a child profile (nickname + age band) and a `parental_consents` row. Verifiable-consent rules differ by jurisdiction; use test data only.
- **Embed (item 5):** `embed.js` mounts a sandboxed iframe. Per-lesson `frame-ancestors` requires the player document to be served by the API, not the static Vercel build; details deferred. Signed read-only token from `POST /lessons/:id/embed-tokens`. No cookies. Replay and reveal only; `postMessage` emits `step` and `complete`.
- **Sandbox (item 9):** curated repos within caps (≤ 5 MB, ≤ 500 files). `sandbox.html` is its own Vite entry; COOP/COEP apply to that path only. Overlay and timeline position saved to `sessionStorage`. Engine builds a full repo snapshot (WP12). Dependencies installed in the browser (`npm ci`). Chromium fully supported; other browsers beta (per `idea.md`). Commercial licence for production.
- **OpenUI and WebContainers research:** OpenUI is MIT. Packages (2026-10-27): `@openuidev/react-lang` (`createLibrary`, `<Renderer>`), `lang-core`, `react-ui`, `cli`. Unknown-component rejection is unconfirmed, so our TS allow-list is the control. WebContainers are free for prototypes, commercial for production; COOP/COEP values unverified.
- **Piper** is GPL-3.0 (`OHF-Voice/piper1-gpl`; `rhasspy/piper` archived): separate container only. **Kokoro** is Apache-2.0; `espeak-ng` (GPL-3.0) is a separate system package. Neither has an OpenAI-compatible server; the engine's own adapter would wrap them.
