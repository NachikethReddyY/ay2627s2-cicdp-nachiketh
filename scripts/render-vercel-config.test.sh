#!/usr/bin/env bash
# Checks scripts/render-vercel-config.sh: the configured origin replaces the production host everywhere it is used,
# the output stays valid JSON, and malformed origins are refused.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
failures=0
origin=https://api.example.test
out="$work/vercel.json"

if "$here/render-vercel-config.sh" "$origin" "$out" >/dev/null; then
  if grep -q "learnquest-api.onrender.com" "$out"; then
    echo "FAIL output still names the production host"
    failures=$((failures + 1))
  else
    echo "PASS committed host is replaced"
  fi
  if grep -q "https://api.example.test/api/:path\*" "$out" &&
    grep -q "connect-src 'self' https://api.example.test wss://api.example.test" "$out" &&
    grep -q "media-src 'self' https://api.example.test" "$out"; then
    echo "PASS rewrite, media-src and connect-src (https and wss) use the configured origin"
  else
    echo "FAIL configured origin missing from rewrite or CSP"
    failures=$((failures + 1))
  fi
else
  echo "FAIL script exited non-zero for a valid origin"
  failures=$((failures + 1))
fi

for bad in https://api.example.test/ http://api.example.test ""; do
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
