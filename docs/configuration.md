# Configuration

Environment variables the API reads (`apps/api/src/env.ts`). Only the sandbox, guide and practice ones are listed here.

## Sandbox (LQ-76)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SANDBOX_ENABLED` | `false` | Off: `/sandbox/*` answers 503 and no backend is ever loaded. |
| `SANDBOX_BACKEND` | `docker` | `docker` runs shells, code runs and practice checks on the API host. `daytona` runs them in Daytona sandboxes. |
| `SANDBOX_IMAGE` | `lq-sandbox:dev` | Docker backend only. |
| `DAYTONA_API_KEY` | – | Required when `SANDBOX_ENABLED=true` and `SANDBOX_BACKEND=daytona`; the API refuses to start without it. |
| `DAYTONA_API_URL` | SDK default | Self-hosted Daytona only. |
| `DAYTONA_TARGET` | SDK default | Region to create sandboxes in. |
| `DAYTONA_SNAPSHOT` | Daytona default image | Snapshot with Python 3, Node.js 22.18 or later, GNU timeout and setpriv. Checks request root for the harness and drop to UID 1001 for learner code. |
| `DAYTONA_AUTO_STOP_MINUTES` | `3` | Idle minutes before Daytona stops a learner's shell sandbox. The Docker backend uses the same 3-minute idle stop. |
| `SANDBOX_MAX_TABS` / `SANDBOX_MAX_SHELLS` / `SANDBOX_MAX_RUNS` | 4 / 50 / 20 | Per-learner tabs, live terminals, live runs. |

## Guide and practice

| Variable | Default | Meaning |
| --- | --- | --- |
| `PRACTICE_STRETCH_TESTS` | `0` | Number of bonus hacker-edition tests (0 to 10) the engine adds to each practice part. They give bonus points only. |
| `AI_WRITE_COURSE_ON_GENERATE` | `true` | When `true`, generating a course writes all its lessons in the background, three at a time, so they are ready when opened. Set `false` to keep the old write-on-open behaviour, for example to hold AI spend down or in tests that count engine calls. |

### How the Daytona backend works

- **Shell:** one sandbox per learner, found by labels `app=learnquest`, `role=shell`, `learner=<sha256 of learner id>`; created if missing, started if stopped, then a PTY is attached. Idle stop is Daytona's own auto-stop, so it holds across restarts and several API instances. Files persist on disk between sessions (unlike Docker, where home is RAM).
- **Practice runs:** each run gets its own throwaway sandbox (`role=runner`) with the network blocked, so a learner cannot alter what a graded run sees through their shell (LQ-75). The program gets the same 60 s limit, counted from when it starts (sandbox creation is extra); stdout and stderr stay separate; stdin lines go through a session command. The sandbox is deleted when the run ends.
- Output from either is untrusted data (ADR-0002).

### Render

Set `SANDBOX_ENABLED=true`, `SANDBOX_BACKEND=daytona` and `DAYTONA_API_KEY` (secret). Daytona runs practice checks in disposable sandboxes with networking blocked. The check uses the language declared by the lesson. Interactive Daytona shells also block network access.

### Not yet built

Global active-sandbox cap: on Daytona `SANDBOX_MAX_SHELLS` counts open terminals per API instance, not idle running sandboxes, and a scheduled cleanup of long-stopped `app=learnquest` sandboxes (set Daytona's auto-delete as a stopgap).
