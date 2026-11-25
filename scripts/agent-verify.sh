#!/usr/bin/env bash
set -euo pipefail

root="${MERGE_GATE_CHECKOUT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$root"

pg_role="${PGUSER:-learnquest}"
pg_secret="${PGPASSWORD:-learnquest}"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://${pg_role}:${pg_secret}@localhost:5432/learnquest_test}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-ci-test-secret-not-for-production-0123456789}"

step() { printf '\n== %s\n' "$1"; }

step "type-aware lint"
pnpm run lint:types

step "boundaries, comments, script tests"
pnpm run test:scripts

step "turbo lint test build"
LEARNSLOP_USE_CACHED_RELEASES=1 pnpm exec turbo run lint test build

step "engine"
(cd services/engine && uv sync --frozen --no-build --python 3.12 && uv run --no-sync ruff check learnquest_engine tests scripts && uv run --no-sync mypy --strict learnquest_engine && uv run --no-sync pytest -q)

printf '\nagent-verify: all checks passed\n'
