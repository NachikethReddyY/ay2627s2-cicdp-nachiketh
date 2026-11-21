#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
base="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')"
temp="$(mktemp -d)"
temp="$(cd "$temp" && pwd -P)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/scripts"
for file in merge-gate.ts revert-rate.ts bin.ts; do
  git show "$base:scripts/$file" > "$temp/scripts/$file"
done
MERGE_GATE_CHECKOUT_ROOT="$root" node "$temp/scripts/merge-gate.ts" "$@"
