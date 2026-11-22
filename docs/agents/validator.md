# Validator: a running copy of LearnSlop for agents

`tools/validator` starts a working copy of the app in one command, signs in a test learner, and lets an agent drive it in a browser. It needs Postgres but not Docker.

## Quick start

```bash
node tools/validator/src/cli.ts up          # Postgres database, migrate, seed, fake-llm, API, web, test learner
node tools/validator/src/cli.ts smoke       # web, API and a signed-in home call
node tools/validator/src/cli.ts browse login   # open the app already signed in
node tools/validator/src/cli.ts browse snapshot -i
node tools/validator/src/cli.ts down        # stop everything
```

`up` prints one JSON object on stdout (`webUrl`, `apiUrl`, `database`, `learner`, `pids`, `logs`, `authState`). Everything else goes to stderr. Run it from the repo root. Root script aliases can wrap the same commands.

## Commands

| Command | What it does |
|---|---|
| `up [--engine] [--fresh]` | Idempotent. Creates the database `learnquest_validator` if missing, runs `db:migrate` and `db:seed`, starts fake-llm (8080), the API (3000) and web (5173), waits for health, signs in `agent@validator.local`, and saves the session. `--engine` also starts the Python engine on 8000 (needs `uv`) and points the API at it. `--fresh` drops and recreates the database first. |
| `down [--drop]` | Stops every recorded process and its children (SIGTERM, then SIGKILL after 5 seconds) and removes state. The database stays unless `--drop`. |
| `status [--json]` | Which services are up and healthy, with URLs. Exit 1 when anything is down. |
| `logs <service> [--tail N]` | Prints a service log: `fake-llm`, `engine`, `api`, `web`. |
| `reset [--hard]` | Truncates learner data (attempts, mastery, progress, enrollments, hints, completions, check results, recommendations). Seeded lessons and the learner account stay. `--hard` does `down` then `up --fresh`. |
| `smoke` | One line per check: web loads, API health, API through the web proxy, signed-in `home.get`. Exit 0 or 1. |
| `browse <args...>` | Runs the local `agent-browser` in the session `validator`. `browse login` opens the web URL already signed in. |
| `env` | Prints `export VALIDATOR_WEB_URL=... VALIDATOR_API_URL=...`. |

Files live in `.validator/` (ignored by git): `state.json` (pids and ports), `logs/<service>.log`, `auth-state.json` (Playwright storage state), `auth-cookies.json` (plain cookie list), `shots/`.

## Environment

| Variable | Default | Use |
|---|---|---|
| `VALIDATOR_WEB_PORT`, `VALIDATOR_API_PORT`, `VALIDATOR_FAKE_LLM_PORT`, `VALIDATOR_ENGINE_PORT` | 5173, 3000, 8080, 8000 | Override ports when running another stack. Pass the same overrides to each validator command. |
| `VALIDATOR_DATABASE_URL` | `postgres://learnquest:learnquest@localhost:5432/learnquest_validator` | Another server or database. Names ending `_test` and `postgres` are refused, so the shared test database is never touched. |
| `VALIDATOR_ADMIN_URL` | the database URL with `/postgres` | A superuser URL used only to create and drop the database, for servers where the app role cannot create databases. |

## The browser loop

`agent-browser` returns a compact accessibility tree with `@e` refs. Act on refs, then snapshot again.

```bash
V="node tools/validator/src/cli.ts browse"
$V login                                  # signed in as the validator learner
$V snapshot -i                            # interactive elements with @refs
$V click @e15                             # click a ref
$V fill @e13 "loops"                      # fill a field
$V wait --text "Start a path"             # wait for what you expect
$V screenshot .validator/shots/home.png   # only when the DOM cannot show it
$V close
```

Relative screenshot paths resolve against your shell directory. Refs go stale after navigation: snapshot again. Run `agent-browser skills get core` for the full guide.

To see a signed-out page (landing, sign-in), `browse close` and then `browse open http://localhost:5173/` without `login`. A browser opened with `login` keeps the session cookie until `close`.

## Playwright or agent-browser

| Use | When |
|---|---|
| The committed suite in `e2e/` | Deterministic regression tests, traces, CI. It runs on the compose stack with `pnpm --filter @learnquest/e2e run ci`. |
| `agent-browser` through `browse` | Exploratory checks by an agent: "does this screen render, does this click work". Snapshots are compact and ref-based, so they cost fewer tokens than screenshots. |

If an exploratory check finds a bug, add a test to `e2e/` or the package that owns it. Do not leave the check only in a chat log.

## Logs

```bash
node tools/validator/src/cli.ts logs api --tail 50
node tools/validator/src/cli.ts logs web
node tools/validator/src/cli.ts status
```

fake-llm answers no model calls unless a fixture is queued, so a feature that needs generation fails here by design. Use `--engine` only to exercise the engine process, not to get real lessons.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port 5173 is already used by node (pid N)` | Another dev server holds the port. `kill N` or stop it, then `up` again. The validator never kills a process it did not start. |
| `Postgres is not reachable at ...` | Start Postgres: `docker compose up -d --wait postgres` (set `ENGINE_TOKEN` to any 40 character value), `brew services start postgresql@16`, or set `VALIDATOR_DATABASE_URL` to a running server. |
| `permission denied to create database` | The app role cannot create databases. Set `VALIDATOR_ADMIN_URL` to a superuser URL, for example `postgres://you@localhost:5432/postgres`. |
| Docker is not running | Not needed. `up` uses Docker only as a fallback when Postgres is unreachable and `docker info` works. |
| A service is `unhealthy` | `logs <service> --tail 100`. The API exits at start on a bad env value; the log names it. |
| Browser shows the landing page | The session expired or you skipped `login`. Run `browse login`, or `up` again to refresh the cookie. |
| State looks wrong | `down` then `up --fresh`. |

## Headless and render-less browsers

`agent-browser` is headless by default. Pass `--headed`, or set `AGENT_BROWSER_HEADED=1`, only when a person needs to watch.

Lightpanda is an optional, untested option: a headless-only browser written for agents. It speaks CDP, so `agent-browser --cdp <port|url>`, Playwright (`chromium.connectOverCDP`) and Puppeteer can drive it. It is beta, licensed AGPL-3.0, has incomplete Web API coverage and cannot take pixel-accurate screenshots. Its speed and memory claims come from the project. Do not rely on it for this app until `pnpm validator smoke` and a real flow pass through it. Use Chrome for anything visual.
