#!/usr/bin/env bash
# Staging smoke gate. Usage: scripts/smoke.sh <api-origin> <web-origin> <engine-origin> <expected-sha>
# Waits until the API and the engine each report the expected build sha (cold start and rollout share one
# budget per service), then checks API readiness, the auth gate on a protected tRPC procedure, and the web
# origin's /api rewrite to that same gate.
set -euo pipefail

api_origin=${1:?api origin required}
web_origin=${2:?web origin required}
engine_origin=${3:?engine origin required}
expected_sha=${4:?expected sha required}
rollout_budget_s=${SMOKE_ROLLOUT_BUDGET_S:-300}
interval_s=${SMOKE_INTERVAL_S:-3}

health_body=$(mktemp)
trap 'rm -f "$health_body"' EXIT

# wait_for_sha <name> <healthz-url>: polls until the service answers 200 with the expected sha.
wait_for_sha() {
  local name=$1 url=$2 code sha deadline=$((SECONDS + rollout_budget_s))
  while :; do
    code=$(curl -s -o "$health_body" -w '%{http_code}' --max-time 10 "$url" || true)
    sha=$(sed -n 's/.*"sha": *"\([^"]*\)".*/\1/p' "$health_body")
    echo "check=$name-healthz status=$code sha=${sha:-none}"
    if [[ $code == 200 && $sha == "$expected_sha" ]]; then
      return 0
    fi
    if ((SECONDS >= deadline)); then
      echo "FAIL: $name healthz did not report $expected_sha within ${rollout_budget_s}s"
      return 1
    fi
    sleep "$interval_s"
  done
}

wait_for_sha api "$api_origin/api/healthz"
wait_for_sha engine "$engine_origin/healthz"

failed=0
check() {
  local name=$1 url=$2 want=$3 code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)
  echo "check=$name status=$code want=$want"
  [[ $code == "$want" ]] || failed=1
}

check readyz "$api_origin/api/readyz" 200
check protected-trpc "$api_origin/api/trpc/home.get" 401
check web "$web_origin/" 200
check web-api-rewrite "$web_origin/api/trpc/home.get" 401

if ((failed)); then
  echo "FAIL: smoke checks failed"
  exit 1
fi
echo "PASS: staging smoke green for $expected_sha"
