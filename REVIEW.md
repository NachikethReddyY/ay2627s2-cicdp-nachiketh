# Review guide

This file tells the automated reviewer, and human reviewers, what matters in LearnSlop. Read [AGENTS.md](AGENTS.md) for the product rules and [CONTRIBUTING.md](CONTRIBUTING.md) for the process. Keep this file short; point to other docs instead of copying them.

## What a failure looks like here

- **A learner sees the answer before predicting.** The UI or API reveals expected output, a hint or an answer key before the learner has answered. This is the most important failure in the product.
- **Answer data reaches the client too early.** Expected output, answer keys or hint text reach the browser before the learner has asked for them. Requested hints (`stepsRouter.hint`) and answers after the learner finishes or skips (`stepsRouter.reveal`) are intended, so do not flag them. Flag only content returned before the learner is allowed to see it, or bundled into `apps/web`.
- **Unauthenticated or cross-learner access.** A route in `apps/api` skips the guards in `apps/api/src/auth`, or returns another learner's attempts, mastery or account data.
- **A secret is committed or shipped.** `ENGINE_TOKEN`, `BETTER_AUTH_SECRET`, `LLM_API_KEY` or a database URL appears in source, a fixture, a log line or a client bundle.
- **Generated content is published without automatic moderation or the creator's explicit choice to share it.** LLM-drafted lessons, quizzes and games start private to their creator. They can reach other learners only after they pass automatic moderation and their creator explicitly chooses to share them. There is no approval queue.
- **A provider lock-in creeps in.** Engine code calls a provider SDK directly instead of the OpenAI-compatible interface.
- **Child or extra personal data.** A change adds child profiles, age bands, parental consent, or stores learner data beyond account email, attempts, mastery (BKT per concept), public handle, XP, streak, timezone and daily goal.
- **Sandbox boundary changes.** Code that runs learner code in `services/sandbox`, or widens what a practice run can reach, needs a close read.
- **Migrations that lose data.** A change in `apps/api/drizzle` drops or rewrites a column or table without a backfill.

Owner decisions 2026-11-21 and 2026-11-22 supersede the earlier human-review and learner-data rules for generated paths and the leaderboard.

## Look hard at

- `apps/api/src/auth/**`, and anything touching sessions, roles or authorisation checks.
- Routes and procedures that return lesson parts, hints or quiz results. Confirm the server strips answers before the response.
- `services/engine/learnquest_engine/prompts/**`. A prompt change alters what every lesson contains.
- `services/sandbox/**` and practice-run code.
- `apps/api/drizzle/**` and `apps/api/drizzle.config.ts`.
- `.github/workflows/**`, especially changes that can skip required checks or disrupt deployment.
- Billing, deployment and infra (`infra/**`, `docker-compose.yml`, `Dockerfile`s).

## Skip

- `docs/plan.html` (generated; review `docs/plan.md`)
- `node_modules/`, `.turbo/`, build output and `.DS_Store`

## Evidence

- Cite a file and line for every finding. Do not flag code from its name or from a guess about what it probably does.
- For a security or answer-leak finding, name the request or code path that exposes the data.
- Mark each finding **Important** (wrong behaviour, leak, or security gap), **Nit** (style or naming), or **Pre-existing** (the PR did not introduce it).
- Reserve change requests for actionable defects introduced by the PR. Do not block on speculative risks, style preferences, or pre-existing issues.

## Nits

- Report at most three nits per review. Skip nits entirely if the PR has a real finding.
- Do not flag style that ESLint (`apps/web`) or Ruff (`services/engine`) would catch. CI already runs them.

## Summary

- Start the summary with the count: "2 important, 1 nit, 0 pre-existing."
- If there is nothing to fix, say so plainly: "No findings."
- Say which checks you could not run.
