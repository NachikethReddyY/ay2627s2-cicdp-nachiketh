@AGENTS.md

# Claude Code notes

- Read `AGENTS.md` first. It holds the product direction (a programming learning tool, not a kids product), the repo map and the working rules.
- Use `docs/plan.md` for the detailed plan. It has the 2026-11-06 pivot applied; `AGENTS.md` is the short version.
- Before any PR push, run the full turbo CI against a test Postgres. The default port is 5432; set `TEST_DATABASE_URL` if yours is elsewhere (see `AGENTS.md`).
