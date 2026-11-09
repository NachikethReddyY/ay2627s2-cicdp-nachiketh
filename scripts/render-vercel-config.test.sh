#!/usr/bin/env bash
# Checks scripts/render-vercel-config.sh: the staging origin replaces the production host everywhere it is used,
# the output stays valid JSON, and malformed origins are refused.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0
origin=https://lq-api-staging.onrender.com
out="$work/vercel.json"

if "$here/render-vercel-config.sh" "$origin" "$out" >/dev/null; then
  if grep -q "learnquest-api.onrender.com" "$out"; then
    echo "FAIL output still names the production host"
    failures=$((failures + 1))
  else
    echo "PASS production host is replaced"
  fi
  if grep -q "https://lq-api-staging.onrender.com/api/:path\*" "$out" &&
    grep -q "connect-src 'self' https://lq-api-staging.onrender.com wss://lq-api-staging.onrender.com" "$out" &&
    grep -q "media-src 'self' https://lq-api-staging.onrender.com" "$out"; then
    echo "PASS rewrite, media-src and connect-src (https and wss) use the staging origin"
  else
    echo "FAIL staging origin missing from rewrite or CSP"
    failures=$((failures + 1))
  fi
else
  echo "FAIL script exited non-zero for a valid origin"
  failures=$((failures + 1))
fi

for bad in https://lq-api-staging.onrender.com/ http://lq-api-staging.onrender.com ""; do
  status=0
  "$here/render-vercel-config.sh" "$bad" "$out" >/dev/null 2>&1 || status=$?
  if [[ $status -eq 0 ]]; then
    echo "FAIL malformed origin '$bad' is accepted"
    failures=$((failures + 1))
  else
    echo "PASS malformed origin '$bad' is refused"
  fi
done

((failures == 0)) || { echo "$failures case(s) failed"; exit 1; }
echo "all render-vercel-config tests passed"
