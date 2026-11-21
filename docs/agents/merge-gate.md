# Merge gate

`pnpm agent:merge` is a retired stub. The gate only runs through the trusted command below, because anything in a PR checkout, including `package.json`, can be redefined by the PR.

```bash
git fetch origin +refs/heads/main:refs/remotes/origin/main && git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh && git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- <pr> --author <claude|codex>
```

Add `--dry-run` to run every check without merging. The command starts from the fully qualified `refs/remotes/origin/main`, so a local tag named `origin/main` cannot shadow it, and it refuses a shallow checkout because the revert rate needs full history.

## How the gate works

1. `scripts/merge-gate-bootstrap.sh` is read from `origin/main`. It extracts `merge-gate.ts`, `revert-rate.ts`, `bin.ts`, `agent-review.ts` and `agent-verify.sh` from base into a temporary directory and runs the base gate against your checkout (`MERGE_GATE_CHECKOUT_ROOT`).
2. The gate refuses to run without the base verify script, refuses `--skip-local` and `--review-result`, and requires `--author claude|codex` exactly once.
3. It checks the PR: open, not a draft, base is `main`, mergeable, no requested changes, no unresolved threads, every CI job green, the 30-day revert rate at or below 5%, and the checkout is the PR head with a clean tree.
4. When the changed files (including the old path of a renamed file) match `SENSITIVE`, the gate runs the base `agent-review.ts --strict` on the PR head. It needs status `clean` for the exact head, and a reviewer of a different family than the author. A file list at GitHub's 3000 file cap is refused as possibly truncated.
5. It runs the base `agent-verify.sh` with the GitHub token variables removed and an empty `GH_CONFIG_DIR`, then squash-merges with `--match-head-commit`.

## Trust boundary

- The first rollout of the bootstrap needs a merge by the owner, because nothing on `origin/main` checks it yet. After that, whoever can push to `main` or bypass branch protection controls the gate.
- Verification still runs the PR's own `pnpm` tasks and test code on your machine. Removing token variables is not isolation from the keychain or the git credential helper. That is why `scripts/` and every `package.json` are sensitive: a PR that changes how checks run needs a clean cross-family review.
- The author family is declared by the caller; the gate cannot establish it independently.
- The file list and head SHA are read in separate requests. A required CI check that runs the policy from base is the follow-up.

## SENSITIVE list

`SENSITIVE` in `scripts/merge-gate.ts` is a list of regular expressions, and `scripts/merge-gate.test.ts` lists the expected paths and fails if one stops matching. It covers:

| Area | Why |
|---|---|
| auth, tRPC guards, access, env and config | who may call what, and secrets |
| `apps/api/src/{sandbox,parts,grading,safety,games/grade,attempts/machine,dev/route}` and routers | answer keys and hints stay server-side |
| `apps/api/src/{progress,lint,ai,engine-client,db,imports,media}/` | learner scoping, authorization, answer writers, engine credentials, migrations, signed media |
| `services/engine/learnquest_engine/` (all) | learner model, prompts, answers, engine token |
| `packages/player-core/src/`, `packages/ui-catalog/src/index.ts`, `.../blocks/game/public.ts`, `apps/web/src/player/` | predict before reveal and answer stripping |
| `scripts/` (all), every `package.json`, `pnpm-lock.yaml`, `e2e/`, `.github/` | the checks and the gate itself |
| Dockerfiles, `.dockerignore`, `docker-compose*.yml`, `uv.lock`, `vite.config.ts`, `neon.ts` | what ships to production |
| `INSTRUCTIONS.md`, `.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `REVIEW.md` | prompts and rules the agents follow |

A hand-written list does not converge on its own: every review found another file. Add a path when a review names one, and add it with the test in the same PR. Whether to flip the default to deny-by-default for `apps/api`, `packages/`, `services/` and `e2e/` is an owner decision.
