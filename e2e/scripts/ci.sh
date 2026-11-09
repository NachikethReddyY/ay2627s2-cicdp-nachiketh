#!/usr/bin/env bash
# Runs the e2e suite on the real compose stack (Postgres, API, engine) with the engine's model calls
# answered by fake-llm. Entry point: `pnpm --filter @learnquest/e2e run ci`.
set -euo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
# A project name of its own keeps this stack, its volume and its network apart from a local `docker compose up`.
COMPOSE=(docker compose -p learnquest-e2e -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.ci.yml")

# Compose needs ENGINE_TOKEN for both the engine and the API. Generated per run unless the caller sets one.
export ENGINE_TOKEN="${ENGINE_TOKEN:-$(openssl rand -hex 32)}"
# Host-side migrate and seed use these. They match the compose Postgres and the API's own settings.
export E2E_POSTGRES_PORT="${E2E_POSTGRES_PORT:-55432}"
export DATABASE_URL="postgres://learnquest:learnquest@localhost:${E2E_POSTGRES_PORT}/learnquest"
export E2E_DATABASE_URL="$DATABASE_URL"
export BETTER_AUTH_SECRET="e2e-secret-not-for-production-0123456789"
export PUBLIC_ORIGIN="http://localhost:5173"

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    "${COMPOSE[@]}" logs --no-color --tail 200 || true
  fi
  "${COMPOSE[@]}" down -v --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT

cd "$ROOT"
"${COMPOSE[@]}" up -d --build --wait postgres
pnpm --filter @learnquest/api run db:migrate
pnpm --filter @learnquest/api run db:seed
"${COMPOSE[@]}" up -d --build --wait engine fake-llm api

cd "$E2E_DIR"
pnpm exec playwright test
