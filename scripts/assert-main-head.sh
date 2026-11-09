#!/usr/bin/env bash
# Refuses to deploy any sha other than the current head of main, so a rerun of an older run cannot roll staging
# back. Usage: scripts/assert-main-head.sh <sha> [remote]
set -euo pipefail

sha=${1:?sha required}
remote=${2:-origin}

head=$(git ls-remote "$remote" refs/heads/main | cut -f1)
if [[ $head != "$sha" ]]; then
  echo "FAIL: $sha is not the head of main (${head:-unknown}); refusing to deploy an older sha" >&2
  exit 1
fi
echo "main is at $sha"
