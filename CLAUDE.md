@AGENTS.md

`AGENTS.md` is the shared source for all coding agents. This file holds only Claude Code specifics.

## Claude Code specifics

- Project skills live in `.claude/skills/`: `verify`, `ci-cd-playbook`, `cicd-best-practices`, `unslop`, `vercel-react-best-practices`. Use `verify` before claiming a change works or pushing a PR, and `ci-cd-playbook` when changing workflows.
- The detailed plan is `docs/plan.md`.
- Memory is per-user and lives outside the repo. Do not put personal preferences in this file.
