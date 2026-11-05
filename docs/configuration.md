# Configuration

Environment variables the API reads (`apps/api/src/env.ts`). Only the sandbox ones are listed here.

## Sandbox (LQ-76)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SANDBOX_ENABLED` | `false` | Off: `/sandbox/*` answers 503 and no backend is ever loaded. |
| `SANDBOX_BACKEND` | `docker` | `docker` runs shells and practice runs on the API host. `daytona` runs them in Daytona sandboxes. |
| `SANDBOX_IMAGE` | `lq-sandbox:dev` | Docker backend only. |
| `DAYTONA_API_KEY` | – | Required when `SANDBOX_BACKEND=daytona`; the API refuses to start without it. |
| `DAYTONA_API_URL` | SDK default | Self-hosted Daytona only. |
| `DAYTONA_TARGET` | SDK default | Region to create sandboxes in. |
| `DAYTONA_SNAPSHOT` | Daytona default image | Snapshot built from `services/sandbox` so Python/Node match the Docker image. |
| `DAYTONA_AUTO_STOP_MINUTES` | `15` | Idle minutes before Daytona stops a learner's shell sandbox. |
| `SANDBOX_MAX_TABS` / `SANDBOX_MAX_SHELLS` / `SANDBOX_MAX_RUNS` | 4 / 50 / 20 | Per-learner tabs, live terminals, live runs. |

### How the Daytona backend works

- **Shell:** one sandbox per learner, found by labels `app=learnquest`, `role=shell`, `learner=<sha256 of learner id>`; created if missing, started if stopped, then a PTY is attached. Idle stop is Daytona's own auto-stop, so it holds across restarts and several API instances. Files persist on disk between sessions (unlike Docker, where home is RAM).
- **Practice runs:** each run gets its own throwaway sandbox (`role=runner`) with the network blocked, so a learner cannot alter what a graded run sees through their shell (LQ-75). The program uses the same 60 s limit; stdout and stderr stay separate; stdin lines go through a session command. The sandbox is deleted when the run ends.
- Output from either is untrusted data (ADR-0002).

### Render

Set `SANDBOX_ENABLED=true`, `SANDBOX_BACKEND=daytona` and `DAYTONA_API_KEY` (secret). Docker and node-pty are not used on this path.

### Not yet built

Global active-sandbox cap beyond `SANDBOX_MAX_SHELLS`, and a scheduled cleanup of long-stopped `app=learnquest` sandboxes (set Daytona's auto-delete as a stopgap).
