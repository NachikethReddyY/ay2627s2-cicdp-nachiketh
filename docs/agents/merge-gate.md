# Merge gate

The gate runs the policy fetched from `origin/main`. Run the bootstrap from the PR checkout with the PR number:

```bash
git fetch origin +refs/heads/main:refs/remotes/origin/main && git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh && git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- 123
```

Add `--dry-run` to check without merging. The gate requires an open, non-draft PR targeting main, a mergeable head, no requested changes or unresolved review threads, and successful CI checks for lint, unit, engine, deploy scripts and e2e. It also checks that the checkout is clean and matches the PR head, runs local verification and rechecks the head and base before squash-merging the exact head.

AI review remains available through `pnpm review`, but the merge gate does not invoke it or require a clean AI verdict. The 30-day revert rate remains available through `pnpm revert-rate` as a metric; it does not block merges. Existing review comments and change requests still need resolution.

The bootstrap executes the gate and verification script from `origin/main`, so changes to this policy take effect only after they land on main. Verification runs the PR's own tasks and test code on the local machine. GitHub token environment variables are removed and an empty `GH_CONFIG_DIR` is used, but this does not isolate the process from the keychain or git credential helper.
