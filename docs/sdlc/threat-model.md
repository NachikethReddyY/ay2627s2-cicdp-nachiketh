# Threat model (STRIDE)

| | |
|---|---|
| **Scope** | LearnSlop as built on `main` at 2026-11-09: `apps/web`, `apps/api`, `services/engine`, `services/sandbox`, and the hosting and third-party services they call. Covers code that exists today and the planned controls in `docs/plan.md` §15 that the code does not yet have. |
| **Date** | 2026-11-09 |
| **Status** | Final, WP15 |
| **Owner** | Nachiketh (solo project) |
| **Supersedes** | The WP0 draft threat model. That draft is not in this repository, so this file replaces it in full. |
| **Companion** | `docs/sdlc/privacy.md` (personal data inventory and privacy note) |

This document records findings. It does not fix them. No code was changed for WP15. Each gap in §5 has a suggested follow-up ticket title and is not yet scheduled.

File references point at the code as of this date. Line numbers were checked against the tree on this date and will drift.

---

## 1. System overview

Learners use a React SPA. The API runs Fastify with tRPC and Better Auth. The engine is a separate Python service that calls LLM, moderation and image providers. Learner code runs in Docker containers on the API host, or in Daytona sandboxes.

```
 Browser (learner)
   |  B1: HTTPS, session cookie, CSP
   v
 Vercel (static SPA; rewrites /api/* to Render)
   |  B2: /api/* rewrite
   v
 Render: API (Fastify, tRPC, Better Auth, sandbox REST and WebSocket)
   |  B3: SQL (Postgres)          -> Neon Postgres
   |  B4: docker CLI on host      -> local containers (or Daytona API)
   |  B5: HTTP, ENGINE_TOKEN      -> Render: Engine (Python, /v1/*)
   |  B6: HTTPS, OpenAI moderation -> api.openai.com
   |  B7: HTTPS, image provider   -> IMAGE_BASE_URL
   v
 Engine
   |  B8: LiteLLM -> LLM provider (LLM_API_BASE)
   |
 Learner browser <- B9: signed media URLs (2 h) -> S3/R2 media storage
```

Trust levels, from most to least trusted: API process and its database; engine (trusted only through `ENGINE_TOKEN`); sandbox containers (run untrusted learner code); browser (untrusted input); LLM and moderation output (untrusted until validated).

Sources: `apps/web/vercel.json` (rewrites and CSP), `apps/api/src/app.ts`, `apps/api/src/auth/auth.ts`, `services/engine/learnquest_engine/server.py`, `apps/api/src/sandbox/`, `apps/api/src/safety/moderation.ts`, `apps/api/src/media/storage.ts`.

## 2. Assets

| ID | Asset | Why it matters | Where it lives |
|---|---|---|---|
| A1 | Answer keys, hints, explanations, hidden tests | Learning value: a learner who sees the answer first learns nothing (AGENTS: predict before reveal). | `steps.secret`, game `hints`, practice hidden tests (server-side only) |
| A2 | Learner accounts and sessions | Account takeover exposes email and learning history. | `user`, `account` (password hash), `session` |
| A3 | Learner attempt data | Personal learning record; drives mastery and recommendations. | `attempts`, `hint_events`, `step_progress`, `mastery`, `recommendations` |
| A4 | Host and sandbox integrity | Escape from a sandbox container gives host access. | API host, Docker daemon, Daytona sandboxes |
| A5 | AI spend budget | Unbounded model calls drive real cost. | `spend_ledger`, `AI_KILL_SWITCH`, `AI_CALL_ESTIMATE_USD` |
| A6 | Engine token | Lets any holder call every engine endpoint. | `ENGINE_TOKEN` (env, ≥ 32 chars) |
| A7 | Content integrity of published lessons | Learners trust published lessons; LLM output must not reach them unreviewed. | `lessons`, `lesson_versions` (published versions are not rewritten, plan §15.10) |

## 3. Threat tables by trust boundary

Residual risk: **Low / Med / High**, the risk left after the existing mitigation, judged for a solo project with a small user base.

### B1. Browser to API (session, CSRF, XSS)

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B1.1 | S | Password guessing on sign-in and sign-up | Rate limit 10 per 60 s on `/sign-in/email` and `/sign-up/email`, in memory (`apps/api/src/auth/auth.ts:37-44`). Per instance, and all users share one IP unless `TRUSTED_PROXY` is set (see F2, F5). A global shared bucket of 10 per minute makes guessing slow when `TRUSTED_PROXY` is unset. No per-account lockout exists; lockout harm is covered by B1.9. | Med |
| B1.2 | S | Session theft | Session cookie set by Better Auth. Cookie flags (httpOnly, Secure, SameSite) not verified (F12). `SameSite=Lax` is cited in `apps/api/src/app.ts:67`. | Med |
| B1.3 | S | Spoofed client IP to defeat rate limit | `x-forwarded-for` is overwritten with `req.ip` (`apps/api/src/auth/routes.ts:18`). Trusted only when `TRUSTED_PROXY` is set (`apps/api/src/app.ts:51`). Test: `apps/api/test/rate-limit-spoof.test.ts`. | Med |
| B1.4 | T | Cross-site request forgery on non-GET calls | Origin check on non-GET requests (`apps/api/src/app.ts:67-79`). No CSRF token; the check is skipped when the `Origin` header is absent (F16). | Low |
| B1.5 | T | XSS in lesson, guide and practice text | CSP in `apps/web/vercel.json` (`script-src 'self'`, `object-src 'none'`). Guide output rendered with ReactMarkdown and no raw HTML (Report A; not re-checked this pass). | Low |
| B1.6 | R | Learner denies an action | Request logs with redacted URL (`apps/api/src/app.ts:40`). No separate audit table for admin or publish actions was found (open item O6). | Med |
| B1.7 | I | Secrets or answers in responses | `steps.secret` never returned; game answers removed by `publicDoc`; practice hidden tests stripped; sample `expectedStdout` sent by design (Report A). Leak tests: `apps/api/test/games.test.ts`, `apps/api/test/parts.test.ts`. Dedicated `apps/api/test/security/` does not exist yet (WP15 item). | Med |
| B1.8 | I | Clickjacking | CSP `frame-ancestors 'none'` in `apps/web/vercel.json`; Helmet registered (`apps/api/src/app.ts:56`). | Low |
| B1.9 | D | Login and sign-up flood | Same as B1.1. No per-IP limit that works behind a proxy without `TRUSTED_PROXY`. | High |
| B1.10 | E | Learner gains admin rights | `adminProcedure` checks `learners.is_admin` on every call (`apps/api/src/trpc/trpc.ts:29`). Flag is set only in the database. | Low |
| B1.11 | E | Learner reads another learner's or a hidden course | `visibleWorld` filters in SQL (`apps/api/src/access.ts:11`); a hidden course looks like a missing one. Path publish is owner-only and moderated (Report A). Whether AI-generated paths reach other learners without human review is open (O13). | Low |

### B2. Learner actions with server-side integrity (progress, games, hints)

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B2.1 | T | Learner marks a learn or watch lesson complete without viewing it | `parts.complete` checks only that the lesson is published and visible, and skips practice and game-practice (`apps/api/src/parts/router.ts:10-25`). No check of viewing or step progress. Affects mastery integrity, not money or other learners. | Low |
| B2.2 | I | Learner reads all hints of a game at once | `games.hint` returns any hint by index with no ladder check (`apps/api/src/progress/games.ts:34-42`). Plan §15.1 says one rung at a time. Answers stay server-side. | Low |
| B2.3 | T | Learner forges a practice pass | Practice checks run in the sandbox harness; the hidden-test token travels on stdin and must come back in the result (`apps/api/src/sandbox/check.ts:50-86`). A forged result line is blocked by the harness running as root and the learner dropping to uid 1001 (see B4.1). | Low |
| B2.4 | R | Learner denies a recorded win or completion | Attempts stored in `attempts`; no signature. | Med |
| B2.5 | D | Learner floods attempts or checks | Run: 2 live runs per learner, 60 s, 4 KB cap (Report A). Check: one in flight per learner (`apps/api/src/sandbox/check.ts:153`, `:172`), 32 s host budget (`:16`), 20,000-character code cap (`:15`). Checks and runs share `SANDBOX_MAX_RUNS` (`:173`). No global rate limit on attempts was found (not verified). | Med |

### B3. Browser to Render API for the guide and AI generation (spend and prompt injection)

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B3.1 | D | Guide chat drives unlimited model spend | Guide route is `apps/api/src/dev/route.ts:101-140`. It has an in-memory limit of 10 per 60 s per learner (`:109-115`). It does not call `reserveAiSpend` and does not check `AI_KILL_SWITCH`. The generation path does both (`apps/api/src/ai/service.ts:73`, `:96`, `:299`; `apps/api/src/config/budget.ts:15-16`). Registered in every environment (`apps/api/src/dev/route.ts:100` comment). The engine has no budget check of its own (F26). | High |
| B3.2 | D | Generation cost by many accounts | `apps/api/src/ai/service.ts` reserves budget per call against `spend_ledger`. Per-learner daily caps exist for paths (`aiPathsPerDay`, `ai/service.ts:90`) and images (`imagesPerDay`, `media/imagegen.ts:79`). Free tier: 5 paths and 1 image per day (`apps/api/src/config/tiers.ts:6`). Guide chat has no daily cap (F1). No cap on account creation (F25). | Med |
| B3.3 | T | Prompt injection through repo files sent to the guide | Up to 24 workspace files, 6 KB each, 18 KB total, text types only, `.env*` and lockfiles excluded (`apps/api/src/dev/route.ts:19-24`, `:43`). Files are sent as data (engine prompt contract, Report A). Output is not validated server-side. | Med |
| B3.4 | T | Prompt injection through learner topic or chat | Topic ≤ 300 chars, moderated (`apps/api/src/ai/service.ts:80`). Moderation fails open (see B6.2). Model output is schema-validated in the engine; LLM calls have no tools (plan §15.5; tool absence not re-checked). | Med |
| B3.5 | I | Learner data sent to providers | Guide chat sends the editor code, selection and messages to the LLM provider. See `docs/sdlc/privacy.md`. | Med |
| B3.6 | E | Model output executes code or HTML in the browser | Client renders Markdown without raw HTML (Report A). Widgets from guide output are not validated server-side (Report A). | Low |

### B4. API to sandbox (code execution)

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B4.1 | E | Learner code escapes the container to host | Check container (`apps/api/src/sandbox/check.ts:50-60`) runs as root (`--user 0:0`) with `--cap-drop ALL` and `SETUID`, `SETGID` and `KILL` added back (`:55-57`). Other flags: `--network none`, `--cpus 0.5`, `--memory 256m`, `--pids-limit 64`, `no-new-privileges`, `--read-only`. Only the learner process drops to uid 1001 via setpriv. `SANDBOX_RUNTIME` is optional (`apps/api/src/env.ts:59`) and is passed as `--runtime` only to shell containers (`apps/api/src/sandbox/docker.ts:51`, `:120`). One-off run and check containers do not get it (`apps/api/src/sandbox/check.ts:46`, `:59`), so setting it does not protect practice runs or checks. When it is unset, shell containers run under runc on a shared host kernel, not gVisor. | Med |
| B4.2 | E | API host compromise through Docker socket | The API process runs the `docker` CLI (`apps/api/src/sandbox/check.ts:64`, `apps/api/src/sandbox/docker.ts:171`). Access to the Docker socket is root-equivalent on the host. Production socket permissions unverified (F3, O2). Whether production uses the socket at all is open (O12). | High |
| B4.3 | I | Learner reads hidden tests in the sandbox | Hidden tests passed on stdin, not argv or env (`apps/api/src/sandbox/check.ts:48`). Harness is a different uid. | Low |
| B4.4 | I/T | Shell reaches other containers or the host network | Docker shell bridge network created with `enable_icc=false` (`apps/api/src/sandbox/docker.ts:38`). Outbound internet not blocked in code; spec says the shell network is on (F6). Production uses Daytona (`docs/configuration.md:33`), so the same outbound exposure applies to the per-learner Daytona shell (`apps/api/src/sandbox/daytona.ts:96-101`), not only to Docker. See F6 and F24. | High until verified |
| B4.5 | D | Fork bomb, memory or disk exhaustion | One-off run and check containers: 0.5 CPU, 256 MB memory, 64 pids. Shell containers: 1 CPU, 1 GB memory, 256 pids and a 512 MB tmpfs (`apps/api/src/sandbox/docker.ts:52-56`). Shell WebSocket frame 64 KB (`apps/api/src/sandbox/route.ts:15`, `MAX_PAYLOAD`). Command output piped from a shell is capped at 64 KB separately (`apps/api/src/sandbox/docker.ts:73`, `PIPE_MAX_BYTES`). Tabs and shells limited (`apps/api/src/sandbox/route.ts:74-75`; `SANDBOX_MAX_TABS`, `SANDBOX_MAX_SHELLS`). Tickets capped per learner at 4 (`apps/api/src/sandbox/ticket.ts:10`). | Med |
| B4.6 | S | Shell WebSocket opened by a different learner | Shell tickets: 32 random bytes (`apps/api/src/sandbox/ticket.ts:61`), 30 s TTL (`apps/api/src/sandbox/ticket.ts:6`), single use, bound to a learner. Origin checked on the WebSocket upgrade (`apps/api/src/sandbox/route.ts:31-41`). | Low |
| B4.7 | I | Shell ticket leaks through URL logs or proxies | Ticket travels in the query string (`apps/api/src/sandbox/route.ts:45`). API request log URL is redacted (`apps/api/src/app.ts:40`, `redactUrl`). Proxy and Render platform logs not verified (F4); the shell WebSocket goes from the browser straight to Render, so the ticket may appear there. Ticket TTL limits the window. | Low |
| B4.8 | I | Daytona sandbox exposes learner code to other tenants | Practice-run Daytona sandboxes use `networkBlockAll: true` and `ephemeral: true` (`apps/api/src/sandbox/daytona.ts:438-439`). The per-learner shell sandbox has network access and is auto-stopped, not deleted, when idle (`apps/api/src/sandbox/daytona.ts:96-101`). It is deleted and replaced only when its state is broken (`apps/api/src/sandbox/daytona.ts:52`, `:92`), so its files persist until then (see F6, F24). Sandbox label is SHA-256 of learner ID (Report B). Daytona retention unverified. | Med |

### B5. API to engine (service-to-service)

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B5.1 | S | Caller pretends to be the API | `ENGINE_TOKEN` must be ≥ 32 chars (`services/engine/learnquest_engine/config.py:20`), compared with `hmac.compare_digest` (`services/engine/learnquest_engine/server.py:62-63`). | Low |
| B5.2 | I | Token sniffed on the wire | API-to-engine transport (`ENGINE_URL`) TLS not verified (F19). | Med |
| B5.3 | T | Engine response tampered with | API validates engine output with zod (Report A). | Low |
| B5.4 | D | Engine unreachable or slow | Engine errors map to 502 or 503 without leaking detail (`apps/api/src/dev/route.ts:134-138`). Engine `/healthz` is the only unauthenticated engine route (`services/engine/learnquest_engine/server.py:125`). | Low |
| B5.5 | E | Engine token leaked in logs or client | Token is read from env; engine logs carry model, tokens, latency, error type only (Report B). | Low |

### B6. API to third-party providers (moderation, LLM, images)

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B6.1 | I | Providers retain or train on learner text | Vendor terms not reviewed in this pass (open item O4). Data sent is listed in `docs/sdlc/privacy.md`. | Med |
| B6.2 | T/D | Moderation outage lets unsafe text through | Topic and generated lesson checks fail open (`apps/api/src/safety/moderation.ts:39-40`, `:59-60`; `apps/api/src/ai/service.ts:80`, `:105`, `:175`). Images never fail open (same file, header comment). Moderation call to `https://api.openai.com/v1/moderations` at `apps/api/src/safety/moderation.ts:14`. | Med |
| B6.3 | I | Image prompts leak learner content | Image prompts go to `IMAGE_BASE_URL` (`apps/api/src/media/imagegen.ts:91-94`). | Med |
| B6.4 | S | Provider response spoofed | Calls over HTTPS to fixed hosts; LLM host set by `LLM_API_BASE` (not fixed in repo). | Low |

### B7. Browser to media storage (signed URLs)

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B7.1 | I | Signed narration or media URL shared | Signed URLs expire after 7200 s (`apps/api/src/media/storage.ts:12`). A URL shared within 2 h still works. | Low |
| B7.2 | I | Media bucket public | Bucket policy not verified (F20). | Med |

### B8. Supply chain and build

| # | STRIDE | Threat | Existing mitigation | Residual |
|---|---|---|---|---|
| B8.1 | T | Malicious or vulnerable dependency (LiteLLM, others) | Hash-locked deps (`uv lock`, pnpm lockfile, plan §15.10); Dependabot; `pip-audit`, `pnpm audit`, Trivy (plan §15.5). CI gates per `docs/plan.md` WP14. The LiteLLM advisory check (plan §15.5, WP0) is not recorded in the repo. | Med |
| B8.2 | T | Secret committed | gitleaks at ingest is planned (plan §15.5); not verified in CI. | Med |

---

## 4. STRIDE summary by category

| Category | Top threats | Residual |
|---|---|---|
| Spoofing | Password guessing and login flood behind a shared IP (B1.1, B1.9); shell network reach (B4.4) | High |
| Tampering | `parts.complete` without viewing (B2.1); repo text into prompts (B3.3); moderation fail-open (B6.2) | Med |
| Repudiation | No audit trail beyond request logs (B1.6); attempts not signed (B2.4) | Med |
| Information disclosure | Hints by index (B2.2); guide sends editor code to LLM (B3.5); Daytona and provider retention (B4.8, B6.1) | Med |
| Denial of service | Guide spend with no kill switch or reservation (B3.1); login flood (B1.9); Docker resource exhaustion (B4.5); free accounts multiply caps (F25) | High |
| Elevation of privilege | Docker socket on API host (B4.2); sandbox escape (B4.1) | High |

---

## 5. Findings

Severity is the impact if the gap is exploited today. Follow-up titles are suggestions. None is scheduled and none is fixed by WP15.

| ID | Finding | Evidence | Severity | Suggested follow-up ticket |
|---|---|---|---|---|
| F1 | Guide chat bypasses the AI spend reservation and the kill switch. Only a 10-per-minute in-memory limit applies. | `apps/api/src/dev/route.ts:101-140`; `apps/api/src/ai/service.ts:73`, `:96`; `apps/api/src/config/budget.ts:15-16` | High | Route guide chat through `reserveAiSpend` and honour `AI_KILL_SWITCH`; add a per-learner daily cap. |
| F2 | Production sign-in rate limit is global when `TRUSTED_PROXY` is unset, since all users share the proxy IP. A single attacker can throttle every sign-in. | `apps/api/src/env.ts:99-103` (startup warning); `apps/api/src/app.ts:51`; `apps/api/src/auth/auth.ts:37-44` | High | Set `TRUSTED_PROXY` to Render's proxy range in production; verify with a staging test. |
| F3 | Docker socket on the API host. Any RCE in the API reaches the host as root. | `apps/api/src/sandbox/check.ts:64`; `apps/api/src/sandbox/docker.ts:171`; `apps/api/src/sandbox/run.ts:78`; production runner question (O12) | High, pending this check | Move execution to Daytona only for production, or isolate the runner host; document socket permissions. |
| F4 | Shell ticket in URL query string. Risk in proxy and access logs; TTL 30 s and single use limit it. | `apps/api/src/sandbox/route.ts:45`; `apps/api/src/sandbox/ticket.ts:6`, `:61`; `apps/api/src/app.ts:40` | Low | Send the ticket in the first WebSocket message or a `Sec-WebSocket-Protocol` header. |
| F5 | In-memory rate limits and per-process state (auth limit, guide limit, ticket map). Multiple instances or a restart reset them. | `apps/api/src/auth/auth.ts:36-37` comment; `apps/api/src/dev/route.ts:18`; `apps/api/src/sandbox/ticket.ts` `pending` map | Med | Store rate-limit counters in Postgres or Redis before running more than one API instance. |
| F6 | Shell egress not verified. Spec says the shell network is on. | `apps/api/src/sandbox/docker.ts:38` (ICC off only); no egress rule found. Production uses Daytona (`docs/configuration.md:33`), so the Daytona shell sandbox (`apps/api/src/sandbox/daytona.ts:96-101`) has the same exposure. | High until verified | Check the host firewall or iptables for the Docker shell network, and the network settings of the Daytona shell sandbox; add an egress test; block outbound by default. |
| F7 | `parts.complete` lets a learner mark a learn or watch lesson complete without viewing it. | `apps/api/src/parts/router.ts:10-25` | Low | Require step progress or a view event before completion; add a test. |
| F8 | `games.hint` returns any hint by index with no ladder check. | `apps/api/src/progress/games.ts:34-42` | Low | Enforce the rung order from plan §15.1 on the server; add a test. |
| F9 | Topic and generated-lesson moderation fail open. | `apps/api/src/safety/moderation.ts:39-40`, `:59-60`; `apps/api/src/ai/service.ts:80`, `:105`, `:175` | Med | Decide per policy: fail closed for topics, keep fail-open for lessons only with a review queue. |
| F10 | No account deletion or data export route. | No route found in `apps/api/src/`; see `docs/sdlc/privacy.md` | Med | Add `account.delete` and `account.export`; cover in the privacy note once built. |
| F11 | `ON DELETE NO ACTION` on learner foreign keys. Deleting a learner fails while attempts, hints, step progress or game completions exist. `game_completions.learner_id` also lacks a cascade. Deleting a user cascades to `learners`, but the learner delete then fails on these keys, so user deletion is blocked one level down. | `apps/api/drizzle/0000_workable_forge.sql:133`, `:136`, `:142`; `apps/api/src/db/schema.ts:435` (`game_completions`); learners to user cascade at `apps/api/drizzle/0000_workable_forge.sql:138` | Med | Migration (expand/contract, plan §15.10) to cascade or to delete child rows first. |
| F12 | Better Auth defaults not verified: cookie flags, scrypt or argon2id, password minimum length, session expiry. Plan §15.5 says argon2id and httpOnly, Secure, SameSite. | `apps/api/src/auth/auth.ts:9` (`emailAndPassword: { enabled: true }` only) | Med | Read the installed Better Auth source and record the values here; set explicit options if they differ from plan §15.5. |
| F13 | Plan and code mismatch: the plan lists GitHub OAuth as a sign-in path (§15.6, WP5). Code has email and password only. | `apps/api/src/auth/auth.ts`; `docs/plan.md` §15.6 | Low (doc only) | Update plan §15.6 and WP5 to email and password, or open a ticket for GitHub OAuth. Requires the user's decision (scope). |
| F14 | Shell egress and provider hosts depend on config that is not fixed in the repo (`LLM_API_BASE`, `IMAGE_BASE_URL`, `ENGINE_URL`). | `services/engine/learnquest_engine/config.py:13`; `apps/api/src/env.ts:20`, `:21` | Med | Pin production values in `docs/configuration.md` and check TLS on each. |
| F15 | Guide workspace files are untrusted text sent into an LLM prompt. Output is unvalidated server-side. | `apps/api/src/dev/route.ts:19-24`, `:43`; Report A | Med | Output schema for guide widgets; test with injection fixtures. |
| F16 | Origin check skipped when the `Origin` header is absent. Browsers always send it on cross-site POST, so impact is limited to non-browser clients. | `apps/api/src/app.ts:67-79` | Low | Require `Origin` on state-changing requests, or accept it as is and note it. |
| F17 | The guide route is registered in every environment, including production. Its file is named `apps/api/src/dev/route.ts`. | `apps/api/src/dev/route.ts:100` comment; `apps/api/src/app.ts:18`, `:128` | Low | Rename or gate by environment; add to F1 ticket. |
| F18 | Shell and sandbox limits are enforced only per instance. | `apps/api/src/sandbox/route.ts:74-75`; `apps/api/src/sandbox/ticket.ts:7`, `:10` | Med | Fold into F5. |
| F19 | Engine-to-API transport TLS not verified. | `services/engine/learnquest_engine/server.py:62-63` (token check only) | Med | Confirm HTTPS on `ENGINE_URL` in production; record in `docs/configuration.md`. |
| F20 | Media bucket public or private status not verified. | `apps/api/src/media/storage.ts:12`, `:43` | Med | Check the bucket policy; add a test that an unsigned URL returns 403. |
| F21 | Security test folder `apps/api/test/security/` does not exist. Plan WP15 requires SSRF tests and a final review of WP5 answer-leak tests. | `apps/api/test/` (no `security/` folder) | Med | Create the folder with answer-leak and rate-limit tests (WP15 follow-up). |
| F22 | No age gate or age field. The 13+ audience is not enforced at sign-up. | `apps/web/src/pages/Login.tsx:21` (no age input) | Low (privacy) | Decide the gate with the user (audience change needs approval per AGENTS). See `docs/sdlc/privacy.md`. |
| F23 | Sign-up name is the email local part, so it can hold a real name. | `apps/web/src/pages/Login.tsx:21` | Low (privacy) | Ask for a display name or default to a neutral label. |
| F24 | Compute and egress abuse from the always-on, network-enabled shell. A learner can run mining, port scanning or spam from our IPs, which could lead to abuse reports against our hosting accounts. | `apps/api/src/sandbox/docker.ts:38`; `apps/api/src/sandbox/daytona.ts:96-101`; see F6 | High | Default-deny egress on shell sandboxes; cap CPU time per shell; alert on sustained CPU and outbound volume. |
| F25 | No email verification. The `verification` table exists but no flow uses it, so one person can create unlimited free accounts. Per-learner limits (guide: 10 per minute; sandbox tabs and shells) then multiply across accounts into Daytona and LLM cost. | `apps/api/src/auth/auth.ts:9` (`emailAndPassword: { enabled: true }` only); `apps/api/src/db/schema.ts:67` (`verification`) | High | Require email verification before AI or sandbox use; add a per-account daily cap and a cap on account creation per IP. |
| F26 | Guide endpoint relies on the API for the kill switch and budget. `/v1/guide/chat` has no engine-side budget backstop, so a leaked `ENGINE_TOKEN` allows unlimited guide spend. | `services/engine/learnquest_engine/server.py:179`; `apps/api/src/dev/route.ts:131`; API-side kill switch at `apps/api/src/config/budget.ts:15-16` | Med | Add an engine-side spend or request cap on `/v1/guide/chat`; rotate `ENGINE_TOKEN` if it may have leaked. |

Findings F1-F3, F6, F24 and F25 should be fixed before the presentation demo, since they can cost money, lock out users, or give host access. F13 and F22 need the user's decision.

---

## 6. Open questions and unverified items

Each item needs a check before this model is treated as complete. None was verified in this pass.

| ID | Item | How to check |
|---|---|---|
| O1 | Better Auth defaults: cookie flags, password hashing (scrypt or argon2id), minimum password length, session expiry and rotation. | Read the installed package in `apps/api/node_modules/better-auth` and the auth config; record values in F12. |
| O2 | Production Docker socket permissions and whether the API user is root. | Render service settings and `docker info` on the host. |
| O3 | Shell network egress on the production host, for the Docker shell network and the Daytona shell sandbox. | Run a container on the shell network and a Daytona shell; try an outbound HTTPS request from each. |
| O4 | Retention and training terms at OpenAI, the LLM provider, the image provider, Daytona, Vercel, Render, Neon and media storage. | Read each provider's current data policy; record the date. |
| O5 | Whether `TRUSTED_PROXY` is set in production. | Render environment variables. |
| O6 | Whether publish and admin actions leave an audit record beyond request logs. | Grep for audit writes; check the DB schema. |
| O7 | Whether the LLM has any tools in the engine call path (plan §15.5 says none). | Read `services/engine/learnquest_engine/llm.py` and the prompt contract. |
| O8 | Contents of `apps/web/src/player/fixtures`. | Read the fixtures for real learner data or secrets. |
| O9 | Existing security tests in `apps/api/test` (rate-limit spoof, leak tests). | Read `apps/api/test/rate-limit-spoof.test.ts` and `apps/api/test/games.test.ts` for what they cover. |
| O10 | LiteLLM advisory check (plan §15.5, WP0). The outcome is not recorded in the repo. | Check the PyPI advisory and the pinned version in `services/engine`. |
| O11 | Whether the guide route's kill-switch gap is intentional. | Ask the user. |
| O12 | Which runner production uses for practice checks. `docs/configuration.md:33` says Daytona, but `/sandbox/check` always runs docker (`apps/api/src/sandbox/check.ts:64`). Either production has a Docker socket on the API host (F3 is real), or practice checks fail there. | Compare `docs/configuration.md` with the Render service settings. Run a practice check on production or staging and see whether it fails. If it runs, run `docker info` on the API host. |
| O13 | Whether AI-generated learner-published paths reach other learners without human review. AGENTS.md says a human approves generated content. Not asserted either way. | Read the path publish flow and the review and moderation steps that apply to published paths. |

## 7. What is not in scope

- Physical security of the developer machine.
- Vercel, Render, Neon and Daytona platform internals.
- The KidsQuest world, which was dropped (plan pivot).
- Stretch items in plan §15 (SANDBOX_FORK, the T3 engine judge, the prompt registry). They are modelled when they land.

## 8. Review cadence

Re-run this model before the first production launch, after any change to auth, the sandbox, or the guide and generation routes, and before each new third-party provider.
