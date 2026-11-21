# Stacking PRs

Use a stack when one change depends on another that is not merged yet. One ticket is one PR.

1. Branch the first PR from `origin/main`, never from a local `main` that may hold unpushed commits. Name it with the ticket key: `LQ-103-short-slug`.
2. Branch the next PR from the first branch and open it with the first branch as its base, so its diff shows only its own change. Put the key in the branch name, in the PR title in parentheses (`fix(scope): subject (LQ-104)`), and as a `Refs LQ-104` footer on each commit, so Jira links it.
3. Keep each PR small enough to pass its own `agent-verify.sh` and review.
4. When the PR underneath merges, retarget the next PR to `main`, rebase it, push, and run the gate again. The gate refuses a PR whose base is not `main`, because its review is of the diff against `main`.
5. Two stacks that edit the same file conflict when the second lands. Do not merge stacks early to avoid it. Say in the PR body which file overlaps, and resolve it by keeping both changes.
6. A PR that documents a whole stack bases on a throwaway integration branch (the top of the stack with any side stack merged in). If that merge conflicts badly, base the docs PR on the top of the stack and say so.
7. Never force-push a branch that already has a review result for its head. Any push changes the head and needs a new review.
