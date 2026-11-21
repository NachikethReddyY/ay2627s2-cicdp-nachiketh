# Merge gate

The gate runs the policy fetched from `origin/main`. `pnpm agent:merge` now prints the trusted bootstrap command and exits. Run the bootstrap from the PR checkout with your PR number and the author family.

```bash
git fetch origin +refs/heads/main:refs/remotes/origin/main && git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh && git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- 123 --author codex
```

Add `--dry-run` to run every check without merging. The command starts from the fully qualified `refs/remotes/origin/main`, so a local tag named `origin/main` cannot shadow it, and it refuses a shallow checkout because the revert rate needs full history.

## How the gate works

1. `scripts/merge-gate-bootstrap.sh` is read from `origin/main`. It extracts `merge-gate.ts`, `revert-rate.ts`, `bin.ts`, `agent-review.ts` and `agent-verify.sh` from base into a temporary directory and runs the base gate against your checkout (`MERGE_GATE_CHECKOUT_ROOT`).
2. The gate refuses to run without the base verify script, refuses `--skip-local` and `--review-result`, and requires `--author claude|codex` exactly once.
3. It checks the PR: open, not a draft, base is `main`, mergeable, no requested changes, no unresolved threads, every CI job green, the 30-day revert rate at or below 5%, and the checkout is the PR head with a clean tree.
4. Unless every changed path is an exempt ordinary document, the gate runs the base `agent-review.ts --strict` on the PR head. It needs status `clean` for the exact head, and a reviewer of a different family than the author. It checks the review classification and freshness against the pinned head and base, then reads a late PR snapshot and refuses if the head or base moved or the gate conditions no longer hold.
5. It runs the base `agent-verify.sh` with the GitHub token variables removed and an empty `GH_CONFIG_DIR`, checks a final snapshot, then squash-merges with `--match-head-commit`.

## Trust boundary

- The owner landed the first bootstrap in #90. Whoever can push to `main` or bypass branch protection controls the gate.
- Verification still runs the PR's own `pnpm` tasks and test code on your machine. Removing token variables is not isolation from the keychain or the git credential helper. That is why `scripts/` and every `package.json` are sensitive: a PR that changes how checks run needs a clean cross-family review.
- The author family is declared by the caller; the gate cannot establish it independently.
- Strict Claude runs in an empty directory with safe mode, restricted tools and MCP disabled. Strict Codex is unavailable because its CLI cannot disable every model tool. Consequently Claude-authored changes requiring review cannot auto-merge. Review input remains untrusted.
- The local diff is classified against the pinned base and head. A required CI check that runs the policy from base is a follow-up.

## Review by default after #91

Every changed path requires review by default. The seven paths below qualify for exemption when a modification keeps both modes at `100644` (regular, non-executable file). An addition or deletion qualifies when its present side has mode `100644` and the other side is absent.

- `README.md`
- `docs/plan.md`
- `docs/feature-map.md`
- `docs/adr/0001-object-storage.md`
- `docs/adr/0002-visual-trust-model.md`
- `docs/adr/0003-engine-boundary.md`
- `docs/adr/0004-coverage-gate.md`

The gate checks both paths of each detected rename or copy. This deliberately increases review volume to cover new files without maintaining a list of sensitive paths.

