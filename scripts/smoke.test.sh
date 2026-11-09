#!/usr/bin/env bash
# Runs scripts/smoke.sh against scripts/smoke-stub.py in each mode and checks the outcome.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sha=test-sha-123
failures=0

free_port() {
  python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}

# run_case <name> <api-stub-mode> <expect: pass|fail> [output-must-contain] [web-stub-mode, default ok]
# The API and engine share one stub; the web origin is a second stub, so a stale web alias can be simulated.
run_case() {
  local name=$1 mode=$2 expect=$3 must_contain=${4:-} web_mode=${5:-ok} api_port web_port out status=0
  api_port=$(free_port)
  web_port=$(free_port)
  python3 "$here/smoke-stub.py" "$api_port" "$mode" "$sha" &
  local api_stub=$!
  python3 "$here/smoke-stub.py" "$web_port" "$web_mode" "$sha" &
  local web_stub=$!
  for port in "$api_port" "$web_port"; do
    for _ in $(seq 50); do
      curl -s -o /dev/null "http://127.0.0.1:$port/" && break
      sleep 0.1
    done
  done

  out=$(SMOKE_ROLLOUT_BUDGET_S=5 SMOKE_INTERVAL_S=1 "$here/smoke.sh" \
    "http://127.0.0.1:$api_port" "http://127.0.0.1:$web_port" "http://127.0.0.1:$api_port" "$sha" 2>&1) || status=$?
  kill "$api_stub" "$web_stub" 2>/dev/null || true
  wait "$api_stub" "$web_stub" 2>/dev/null || true

  local ok=1
  if [[ $expect == pass && $status -ne 0 ]]; then ok=0; fi
  if [[ $expect == fail && $status -eq 0 ]]; then ok=0; fi
  if [[ -n $must_contain && $out != *"$must_contain"* ]]; then ok=0; fi

  if ((ok)); then
    echo "PASS $name"
  else
    echo "FAIL $name (exit $status, expected $expect)"
    printf '%s\n' "$out" | while IFS= read -r line; do echo "    $line"; done
    failures=$((failures + 1))
  fi
}

run_case "ok: all checks pass" ok pass
run_case "cold: healthz recovers after 503s" cold pass
run_case "stale: healthz keeps reporting the old sha" stale fail "sha=old-sha"
run_case "engine-stale: engine reports an old sha" engine-stale fail "FAIL: engine healthz did not report"
run_case "open: protected route answers 200" open fail "check=protected-trpc status=200"
run_case "down: healthz never recovers" down fail "FAIL: api healthz did not report"
run_case "web-stale: web alias forwards to an old release" ok fail "FAIL: web healthz did not report" stale

if ((failures)); then
  echo "$failures smoke test(s) failed"
  exit 1
fi
echo "all smoke tests passed"
