# API build and deploy plan (WP5, WP8, WP13-api, WP16)

> Source of truth: `docs/plan.md` §5, §7, §8, §9, §15. This file turns those into small task cards that a cheaper model can finish one at a time.
> When this file and `plan.md` disagree, this file wins for **how**; `plan.md` wins for **what**. Deviations are listed in §2.
> Status: draft 2026-10-28. Nothing here is built yet: `apps/api` has no SSE, worker or pg-boss code, and `apps/web` uses fixtures only (no backend calls).

---

## 0. How to hand a task to a cheaper model

One task card = one session = one PR. Paste this prompt, filling in the task ID:

```
You are implementing task <T#> from docs/api-plan.md in the LearnSlop repo.
Read: docs/api-plan.md §1–§3 and the <T#> card. Read the plan.md sections the card names. Nothing else unless stuck.
Rules:
- Touch only the files the card lists. Add only the dependencies the card lists.
- TypeScript runs directly on Node (type stripping): erasable syntax only (no enums, no namespaces, no parameter properties). Import local files with the .ts extension.
- Done = every "Test" bullet passes with `pnpm --filter @learnquest/api test` and `pnpm --filter @learnquest/api lint`.
- If the card is ambiguous or a contract looks wrong, stop and write the question in the PR description. Do not invent API shapes.
- Conventional Commit message, small PR.
```

**Model per task** (column "Model" in §4): **H** = Claude Haiku 5.5 is fine (mechanical, fully specified). **S** = Claude Sonnet 5.5 (some judgement). **S+R** = Sonnet writes it, then a stronger model or you review it (security or state logic).

---

> **Status (2026-11-05):** The SSE module, the background worker and pg-boss are not built yet. `apps/api` has no pg-boss dependency. Generation runs in-process on the request, not in a queue. The task cards below describe the planned design.

## 1. Fixed decisions (the cheap model must not re-decide these)

| Topic | Decision |
|---|---|
| Runtime | Node ≥ 22.18, ESM, **no build step**: `node src/server.ts` (type stripping, like `player-core`). Copy `packages/player-core/tsconfig.json` settings. |
| Framework | Fastify 5 + `fastify-type-provider-zod` + `zod`. Every route has a Zod `schema` for params, body and response. |
| Route prefix | **All routes live under `/api`** inside Fastify (`app.register(routes, { prefix: "/api" })`). The same path works in local dev (Vite proxy), on Render, and through the Vercel rewrite, with no path rewriting. |
| DB | Postgres 16, `drizzle-orm` + `pg` (`node-postgres`), migrations via `drizzle-kit generate` (committed SQL in `apps/api/drizzle/`) and a tiny `src/db/migrate.ts` that calls `migrate()`. |
| Queue | `pg-boss` in the API process. Queues are created with `policy: "short"` (the spike showed `singletonKey` doesn't dedupe without it). |
| Tests | `node:test` + `node:assert/strict` (same as `player-core`) + `supertest` against `app.server` (or `app.inject()`). Real Postgres, no mocks for the DB. Run with `--test-concurrency=1`; `test/helpers.ts` truncates all tables before each test. |
| Engine in tests | Never called for real. `src/engine-client/` exports an interface; tests pass a fake object to `buildApp({ engine })`. |
| Sessions | Random 32-byte token in httpOnly cookie `lq_session` (`Secure` in prod, `SameSite=Lax`, `Path=/api`). DB stores `sha256(token)` only. 30-day expiry. |
| CSRF | `SameSite=Lax` cookie **plus** an `onRequest` hook that rejects any non-GET whose `Origin` header ≠ `PUBLIC_ORIGIN` (403). No token library. |
| Passwords | `@node-rs/argon2` (argon2id defaults). |
| Cloze grading (T2) | Small hand-written tokenizer, **not** the `typescript` scanner: TS 7.0.2 only exposes `createScanner` under `typescript/unstable/ast/scanner`. The cloze answer is one identifier or literal, so a ~20-line tokenizer is enough. |
| Import progress | **Polling first**: `GET /api/jobs/:id`. SSE (`/jobs/:id/events`) only after the Vercel leg of the SSE spike passes (`spikes/sse-rewrite/README.md`). This is plan §11.3's named fallback. |
| Engine auth | Engine calls send `Authorization: Bearer $ENGINE_TOKEN`. The engine is on a public Render URL, and without this anyone could spend the LLM budget. |
| Not built now | OpenAPI/swagger (needed only for the stretch SDKs), CORS (same-site, not needed), Redis, password reset, all stretch endpoints. |

## 2. Deviations from plan.md (owner should OK these)

1. Tests use `node:test` + SuperTest, not Jest + SuperTest. This matches `player-core`. If the course rubric requires Jest by name, swap the runner in T1. Nothing else changes.
2. CI Postgres comes from a GitHub Actions `services:` container, not Testcontainers. It's simpler and has the same coverage.
3. T2 cloze uses a tokenizer, not the `typescript` scanner (see §1).
4. Import progress polls first; SSE comes later (see §1).
5. `ENGINE_TOKEN` is new (see §1). Add it to plan §15.10 secrets.
6. "Failures" for `explanationStyle`/`skipOffered` (plan §8.2) means: this learner's observed-incorrect attempts on any step that shares a concept with this step. The plan doesn't say which concept counts.

## 3. Shared facts

**Layout** (plan §10; only these files are new):
```
apps/api/
  package.json  tsconfig.json  drizzle.config.ts
  drizzle/                     generated SQL migrations (committed)
  src/server.ts                listen on PORT; starts worker if WORKER_IN_PROCESS=true
  src/app.ts                   buildApp(opts) → FastifyInstance (no listen; tests use it)
  src/env.ts                   Zod-parsed process.env, exported as `env`
  src/db/{schema.ts,client.ts,tx.ts,migrate.ts,seed.ts}
  src/auth/{routes.ts,session.ts,github.ts,guards.ts}
  src/lessons/routes.ts
  src/attempts/{machine.ts,routes.ts}
  src/grading/{mcq.ts,cloze.ts}
  src/progress/routes.ts
  src/worker/{queue.ts,mastery.ts,import.ts}
  src/engine-client/index.ts
  test/{helpers.ts,fixtures/,*.test.ts}  test/security/ (WP15)
packages/lesson-schema/src/index.ts   Zod contracts (T0)
```

**Env vars** (`src/env.ts`, validated at boot; the process exits if one is missing):
`DATABASE_URL` (direct connection, **not** a transaction pooler: no `-pooler` in a Neon host), `BETTER_AUTH_SECRET` (32+ chars), `PUBLIC_ORIGIN` (e.g. `http://localhost:5173`), `PORT` (default 3000), `NODE_ENV`, `ENGINE_URL`, `ENGINE_TOKEN`. Planned, not read by the API yet: `WORKER_IN_PROCESS` (default `true`), `WORLDS` (default `codequest`), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. The GitHub pair is for T9/T10; their routes should return 503 when they're unset.

**Transaction + enqueue helper** (`src/db/tx.ts`). Every write path uses this, so the job and the rows commit together (proven by `spikes/pgboss-enqueue`):
```ts
export async function withTx<T>(fn: (db: Db, client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(drizzle(client, { schema }), client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
// enqueue inside the tx:
await boss.send("mastery", { attemptId }, {
  singletonKey: `mastery:${attemptId}`,
  db: { executeSql: (text, values) => client.query(text, values) },
});
```

---

## 4. Task cards (do them in order; each depends on the ones above it)

| # | Task | Model | Size |
|---|---|---|---|
| T0 | `lesson-schema` contracts | H | S |
| T1 | API bootstrap + health + test harness + CI Postgres | H | S |
| T2 | Graders (MCQ, cloze) | H | S |
| T3 | DB schema + migrations + seed | S | M |
| T4 | Email/password auth + sessions + guards | S+R | M |
| T5 | Read endpoints (worlds, lessons) + leak tests | S | S |
| T6 | Step machine + attempts/hints/skip/reveal | S+R | L |
| T7 | Engine client + mastery worker + `/me/*` | S | M |
| T8 | Author: import job, polling, publish | S | M |
| T9 | GitHub OAuth | S+R | S |
| T10 | Web wiring: Vite proxy | H | XS |
| D1–D6 | Deploy (§5) | H/S | — |

### T0. `packages/lesson-schema` (Zod contracts)
- **Files:** `packages/lesson-schema/{package.json,tsconfig.json,src/index.ts,src/index.test.ts}`. Copy `player-core`'s package.json shape (`exports: "./src/index.ts"`). Dep: `zod`.
- **Do:** export Zod schemas and inferred types for: `Files`, `Hunk` (same shape as `player-core/src/types.ts`), `Prompt` (`{type:"mcq",question,options:[4]}` | `{type:"cloze",text}` where `text` has exactly one `____`), `StepPublic` `{title, prompt, hintCount}`, `StepSecret` (plan §7 comment: `beforeFiles, afterFiles, hunks, answer, accepted[], hints[], explanations{workedExample,practice}, source{repo,sha,path}`), `AttemptBody` (plan §9 shapes; cloze `text` ≤ 200), `LessonFile` (the seed JSON format: `{slug, title, concepts[], position, status?, source?, steps:[{id?, public, secret}]}`; `secret` holds `beforeFiles, hunks, answer, accepted, hints, explanations` and the optional `narration` text spoken or captioned on reveal; it lives in `apps/api/src/db/lesson-file.ts`), and `PedagogyResponse` (plan §9 engine shape).
- **Don't:** touch `player-core` (its own `shortcut:` comment covers switching it over later).
- **Test:** valid and invalid example for each union; cloze with 0 or 2 blanks is rejected; MCQ with 3 options is rejected.

### T1. Bootstrap
- **Files:** `apps/api/{package.json,tsconfig.json}`, `src/{app.ts,server.ts,env.ts}`, `src/db/client.ts`, `test/{helpers.ts,health.test.ts}`, `.github/workflows/ci.yml`, `docker-compose.yml` (postgres only for now; `infra/docker` comes in D1).
- **Deps:** `fastify fastify-type-provider-zod zod drizzle-orm pg @fastify/cookie @fastify/helmet @fastify/rate-limit pg-boss @node-rs/argon2 yaml @learnquest/lesson-schema@workspace:*`; dev: `drizzle-kit supertest @types/supertest @types/pg @types/node typescript`.
- **Scripts:** `"dev": "node --watch src/server.ts"`, `"start": "node src/server.ts"`, `"test": "node --test --test-concurrency=1 'test/**/*.test.ts'"`, `"lint": "tsc --noEmit"`, `"db:generate": "drizzle-kit generate"`, `"db:migrate": "node src/db/migrate.ts"`, `"db:seed": "node src/db/seed.ts"`.
- **Do:** `buildApp({ engine? })` registers helmet, cookie, the zod compilers, `genReqId` (uses the incoming `x-request-id` if present), `trustProxy: true`, pino JSON logs, an error handler that returns `{error:{code,message}}` and never a stack trace in prod, and the `/api` prefix. `GET /api/healthz` → `{ok:true}`. `GET /api/readyz` → runs `SELECT 1`, returns 503 if it fails. CI: add a `services: postgres:16` block with `DATABASE_URL` env to the existing job.
- **Test:** healthz 200; readyz 200 with the DB up; unknown route → 404 JSON in the `{error}` shape.

### T2. Graders (WP16, pure functions)
- **Files:** `src/grading/{mcq.ts,cloze.ts}`, `test/grading.test.ts`. No DB imports.
- **Do:** `gradeMcq(choice, answerIndex) → boolean`. `gradeCloze(text, answer, accepted[]) → boolean`: strip `//…` and `/*…*/` comments, tokenize (identifiers, numbers, string literals with their quotes, single punctuation chars), drop whitespace, and return true iff the token list equals the tokens of `answer` or of any `accepted` item. Plan §15.1.
- **Test:** `" total "` = `"total"`; `"total /*x*/"` = `"total"`; `"'a'"` ≠ `"\"a\""` unless `accepted` lists it; empty string is false; 200-char garbage is false; an accepted variant passes.

### T3. DB schema, migrations, seed
- **Files:** `src/db/{schema.ts,migrate.ts,seed.ts,tx.ts}`, `drizzle.config.ts`, `drizzle/*`, `test/fixtures/lesson-fixture.json`, `test/seed.test.ts`.
- **Do:** every **core** table in plan §7, exactly as named (snake_case columns). Enums as pgEnums. Add a partial unique index `attempts (learner_id, step_id) WHERE observed`. Skip the stretch tables. `seed.ts` reads `worlds/codequest/manifest.json` and `worlds/codequest/lessons/*.json` (validated with `LessonFile`), then upserts `worlds`, `concepts`, `concept_edges`, `lessons`, version 1, and `steps`. It marks lessons `published` (synthetic lessons are hand-reviewed) and is idempotent by lesson slug. Before WP11 writes real content, tests use `test/fixtures/` with one 2-step lesson (one MCQ step, one cloze step).
- **Test:** migrate on an empty DB; seeding twice leaves the same row counts; `steps.secret` round-trips.

### T4. Auth (email/password)
- **Files:** `src/auth/{routes.ts,session.ts,guards.ts}`, `test/auth.test.ts`.
- **Do:** `POST /api/auth/register {email,password(8..200)}` creates `users` (role `learner`) and a `learners` row, then creates a session and sets the cookie. `POST /login`: on a wrong email or a wrong password it returns the same 401, and it calls argon2 verify even when the email is unknown (timing). Rate limit: 10/min per IP plus 5/min per email on login and register. `POST /logout` sets `revoked_at` and clears the cookie. `GET /api/auth/me` → `{id,email,role}` or 401. Guards: `requireUser` (decorates `req.user`, `req.learnerId`) and `requireRole("author")`. CSRF: the Origin hook from §1.
- **Test:** register→me→logout→me 401; a duplicate email gets 409; a wrong password gets 401; the cookie is httpOnly; a POST with `Origin: https://evil.test` gets 403; the 6th login in a minute for the same email gets 429; the DB never holds the raw token.

### T5. Read endpoints
- **Files:** `src/lessons/routes.ts`, `test/lessons.test.ts`.
- **Do:** `GET /api/worlds`, `GET /api/worlds/:slug/concepts`, `GET /api/lessons?world=` (published only), `GET /api/lessons/:id` (plan §7 "Lesson response": each step's `state` comes from `step_progress`, default `predicting`). Learners get 404 for draft lessons. All require login.
- **Test (leak tests):** walk every response from these routes and assert that no key named `secret`, `answer`, `answerIndex`, `accepted`, `hints`, `hunks`, `beforeFiles`, `afterFiles`, `explanations` or `source` appears at any depth. A draft lesson gets 404 for a learner.

### T6. Step machine (the hard one; review carefully)
- **Files:** `src/attempts/{machine.ts,routes.ts}`, `test/machine.test.ts`, `test/attempts.test.ts`.
- **Do in two layers:**
  1. `machine.ts` is a **pure** function: `next(progress, action, step) → { progress, outcome } | { conflict: string }`. No DB. Test it exhaustively with the table below.
  2. `routes.ts` is thin: `withTx` → `INSERT … ON CONFLICT DO NOTHING` the default `step_progress` row → `SELECT … FOR UPDATE` → `next()` → write `step_progress`, `attempts` / `hint_events` → enqueue `mastery` if the attempt is `observed` → commit → respond.

`progress = {state, rungsTaken, attemptAllowed, retryAllowed}`, default `{predicting, 0, true, false}`. `hintCount` = 2 (MCQ) or 3 (cloze). `first` = no `attempts` row exists yet for (learner, step).

| State | Action | Condition | Result |
|---|---|---|---|
| revealed / skipped | attempt, hint, skip | — | **409** |
| hinting | attempt | `!attemptAllowed && !retryAllowed` | **409** "take the next hint first" |
| predicting / hinting | attempt | correct | → `revealed` |
| predicting | attempt | wrong | → `hinting`, `attemptAllowed=false` |
| hinting | attempt | wrong, `retryAllowed` | → `revealed` (auto-reveal), `retryAllowed=false` |
| hinting | attempt | wrong, `rungsTaken == hintCount` | stay `hinting`, `attemptAllowed=false`, `retryAllowed=true` |
| hinting | attempt | wrong, rungs left | stay `hinting`, `attemptAllowed=false` |
| predicting / hinting | hint | `rungsTaken == hintCount` | **409** |
| predicting / hinting | hint | else | `rungsTaken+1`, → `hinting`, `attemptAllowed=true`; insert `hint_events` |
| predicting / hinting | skip | — | → `skipped`; insert an `attempts` row with `kind=skip`, `correct=null` |

Every attempt or skip row stores `observed = first` and `hints_used = rungsTaken`. The mastery observation (worker, T7) is "correct" only if `correct && hints_used == 0`; everything else observed counts as incorrect (plan §8.2).

Endpoints (plan §9 shapes, all `requireUser`, the lesson must be published):
- `GET /api/steps/:id` → `{prompt, state, hintCount, rungsTaken, attemptAllowed, explanationStyle, skipOffered, beforeFiles|null}`. `beforeFiles` is returned for `idx 0`, or when the previous step's state is `revealed`/`skipped`; otherwise it's `null`. `failures` (§2 item 6): `explanationStyle = floor(failures/3) % 2 ? "practice" : "worked_example"`, `skipOffered = failures >= 6`.
- `POST /api/steps/:id/attempts` → `{attemptId, correct, feedback:{message}, missedConcepts, hintsUsed, state}`. The feedback message is generic ("Not quite" / "Correct") and never includes the answer. `missedConcepts` = the step's concepts when the answer is wrong, otherwise `[]`.
- `POST /api/steps/:id/hints` → `{rung, text, eliminate?}`. `eliminate` is MCQ rung 1 only: the lowest option index ≠ the answer (deterministic).
- `POST /api/steps/:id/skip` → `{state:"skipped"}`.
- `GET /api/steps/:id/reveal` → `{answer, hunks, explanations:{workedExample, practice, inferred:true}, source}`. **409** unless the state is `revealed`/`skipped`.
- **Test:** `machine.test.ts` has one test per table row. `attempts.test.ts` covers: the full MCQ path (wrong → hint → wrong → hint → wrong → retry wrong → revealed); a correct first try; skip; reveal is 409 before and 200 after; 20 parallel identical attempts produce exactly one `observed=true` row (the lock works); a rollback leaves no pg-boss job; the leak walk from T5 run on `GET /steps/:id` and on the hint response before reveal.

### T7. Engine client, mastery update, progress
- **Files:** `src/engine-client/learner.ts`, `src/progress/mastery.ts`, `src/progress/me.ts`, `test/mastery.test.ts`.
- **Do:** no pg-boss worker (PROPOSED, see `docs/plan.md` §8.2). The mastery update runs inline after the attempt commits, and `me.mastery` and `me.next` catch up on read. Idempotency comes from `attempts.mastery_applied_at`. The engine client is a seam object `engineLearner = { update, next }` with Zod-parsed responses. `GET /api/me/progress` → `[{conceptId, slug, name, pKnown, nObs}]`. `GET /api/me/next?world=` → the latest recommendation or `null`. Full design: `docs/lq-22-plan.md`.
- **Test:** with a fake engine, an observed correct attempt raises `p_known`; applying the same observation twice does not double `n_obs`; a non-observed attempt doesn't call the engine; an engine failure leaves the attempt at 200 and a later read catches up.

### T8. Author: import, job status, publish
- **Files:** `src/worker/import.ts`, more routes in `src/lessons/routes.ts`, `test/import.test.ts`.
- **Do:** `POST /api/lessons/import {repo, sha}` (author): the repo must be in `worlds/codequest/repos.yml` (else 400). In `withTx`, insert `lesson_jobs` (`queued`) and enqueue `import`, then return `202 {jobId}`. The handler sets `running`, then calls `engine.ingest` → `engine.pedagogy` → re-validates with Zod → writes the draft `lessons` row (`source_kind=repo`), `lesson_versions` and `steps`, plus one `llm_calls` row from `usage`. It updates `progress` at 10/50/90/100 and finishes `done` with `lesson_id`. On any error it sets `failed` with a short `error`. `GET /api/jobs/:id` → `{status, progress, error, lessonId}` (creator only, otherwise 404). `GET /api/author/lessons?status=draft`, `POST /api/lessons/:id/publish|unpublish` (author; publish sets `published_at` and `current_version_id`).
- **Test:** an off-list repo gets 400; a learner gets 403; with a fake engine the job ends `done` and the draft exists; when the fake engine throws, the job ends `failed`; another user gets 404 on the job.

### T9. GitHub OAuth
- **Files:** `src/auth/github.ts`, `test/github.test.ts`.
- **Do:** `GET /api/auth/github` sets a random `state` in a short-lived httpOnly cookie and redirects to `github.com/login/oauth/authorize` (scope `read:user user:email`, `redirect_uri = PUBLIC_ORIGIN + /api/auth/github/callback`). The callback checks `state`, exchanges the code, fetches `/user` and `/user/emails` (primary + verified), and upserts `users` and `oauth_accounts`. It **does not** link to an existing password account by email unless that email is verified on GitHub. Then it creates a session and redirects to `/`.
- **Test:** a bad `state` gets 400; with GitHub mocked via an injectable `fetch`, a new user gets created and a second login reuses the same user.

### T10. Web dev proxy
- **Files:** `apps/web/vite.config.ts` (it has no `server` block today).
- **Do:** add `server: { proxy: { "/api": "http://localhost:3000" } }`. No path rewrite (routes already start with `/api`).

---

## 5. Deployment

Target (plan §6.9): **Vercel** (web, static) → rewrites `/api/*` → **Render** (API container, pg-boss in process) → **Neon** Postgres. The engine is a second Render service (WP6/WP13, not in this doc). Prices aren't verified (WP0 item 4 is still open); check the free-tier limits before D2.

### D1. Container (`infra/docker/api.Dockerfile`), model H
Multi-stage: `node:22-slim` → `corepack enable` → `pnpm install --frozen-lockfile --filter @learnquest/api...` → copy `apps/api`, `packages/lesson-schema` and `worlds/` → `USER node` → `CMD ["node","apps/api/src/server.ts"]`. No build stage is needed. Add an `api` service to `docker-compose.yml`. **Test:** `docker compose up` then `curl localhost:3000/api/healthz`.

### D2. Accounts (owner, by hand, once): plan Q5
1. **Neon:** one project, two branches, `staging` and `prod`. Copy the **direct** connection string (host without `-pooler`, `?sslmode=require`) for each.
2. **Render:** two Web Services (`lq-api-staging`, `lq-api-prod`), type "Existing image" `ghcr.io/<owner>/learnquest-api:<tag>`, health check path `/api/healthz`. Set the §3 env vars, with `NODE_ENV=production`, `WORKER_IN_PROCESS=true`, and `PUBLIC_ORIGIN` = the Vercel URL. Copy each service's **deploy hook URL**.
3. **GitHub OAuth apps:** one per environment, callback `https://<vercel-host>/api/auth/github/callback`.
4. **Vercel:** two projects (staging, prod), root `apps/web`. Copy the token, org ID and project IDs.
5. **GitHub:** environment `staging` (LQ-29; `production` comes with the prod work) with secrets `DATABASE_URL`, `RENDER_DEPLOY_HOOK_API`, `RENDER_DEPLOY_HOOK_ENGINE`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and vars `API_ORIGIN`, `ENGINE_ORIGIN` and `WEB_ORIGIN`. Make the GHCR packages public, or give Render registry credentials. Step-by-step setup: `docs/runbooks/staging-deploy.md`.

### D3. Vercel rewrite, model H
Edit `apps/web/vercel.json`. The API rule must come **before** the SPA catch-all, because the current catch-all regex also matches `/api`:
```json
"rewrites": [
  { "source": "/api/:path*", "destination": "https://__API_ORIGIN__/api/:path*" },
  { "source": "/((?!assets/|audio/).*)", "destination": "/index.html" }
]
```
CI replaces `__API_ORIGIN__` per environment with `sed` before `vercel deploy`.

### D4. Deploy workflow (`.github/workflows/deploy-staging.yml`, LQ-29), model S
Implemented for staging in LQ-29; where this list and the workflow differ, the workflow wins. Runs on push to `main`:
1. Build and push `ghcr.io/<owner>/learnquest-api:${{ github.sha }}` (`permissions: packages: write`).
2. **Migrate** staging: `DATABASE_URL=${{ secrets.DATABASE_URL }} pnpm --filter @learnquest/api db:migrate` (runs from Actions, so it doesn't need Render's pre-deploy feature). Migrations must be expand-only (plan §15.10).
3. `curl -fsS -X POST "$RENDER_DEPLOY_HOOK&imgURL=ghcr.io/<owner>/learnquest-api:${SHA}"`.
4. Web: `sed` the API origin into `vercel.json`, then `vercel pull --yes --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod`.
5. Smoke (D5) against the staging Vercel URL.
6. The `production` environment (protected by a required reviewer once the repo is public) repeats steps 2–5 with prod secrets.

### D5. Smoke (`scripts/smoke.sh <api-origin> <web-origin> <engine-origin> <sha>`), model H
Implemented in LQ-29. Retry `GET /api/healthz` (API) and `GET /healthz` (engine) until each reports the commit SHA just deployed. The budget (default 300 s) covers Render free-tier cold starts and the rollout. Then require `GET /api/readyz` = 200, `GET /api/trpc/home.get` = 401 (a protected procedure; the `/api/lessons` route in the earlier draft does not exist, since the API serves tRPC), and the web origin's `/` = 200 and `/api/trpc/home.get` = 401 (proves the Vercel rewrite reaches Fastify, not `index.html`). Exit non-zero on failure.

### D6. Rollback (document in README)
API: run the deploy hook with the previous SHA's `imgURL`. Web: Vercel dashboard → previous deployment → Promote. DB: migrations are expand-only, so the old code still runs against the new schema.

---

## 6. Open items (owner)

- OK the §2 deviations, especially the test runner (Jest vs `node:test`) if the course rubric names Jest.
- Run the Vercel leg of the SSE spike once D2/D3 exist. If it passes, add SSE as a T8 follow-up.
- Verify free-tier limits: Render sleep and cold start, Neon compute hours (pg-boss polling keeps Neon awake whenever the API is awake).
- T3's seed needs `worlds/codequest/manifest.json` and lesson JSON (WP11). Until then, tests use the fixture lesson.
