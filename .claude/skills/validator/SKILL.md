---
name: validator
description: Use when you must see or test the running app. Starts a working LearnSlop (database, seeded lessons, API, web, signed-in test learner) in one command and drives it with agent-browser. Use for exploratory checks of a screen, a flow or a bug before claiming a UI change works.
---

# Validator

Run a real copy of the app and look at it.

```bash
node tools/validator/src/cli.ts up              # start; prints JSON with webUrl and apiUrl
node tools/validator/src/cli.ts smoke           # confirm it works
node tools/validator/src/cli.ts browse login    # browser opens signed in as the test learner
node tools/validator/src/cli.ts browse snapshot -i
node tools/validator/src/cli.ts browse click @e3
node tools/validator/src/cli.ts logs api --tail 50
node tools/validator/src/cli.ts reset           # clear learner progress, keep lessons
node tools/validator/src/cli.ts down            # always stop when done
```

- Prefer `snapshot -i` over screenshots. Screenshot only for visuals the DOM cannot show.
- Use screen and feature names from `docs/feature-map.md`.
- Write regression tests in `e2e/`, not here. This is for exploration.
- Full guide, environment variables and troubleshooting: `docs/agents/validator.md`.
