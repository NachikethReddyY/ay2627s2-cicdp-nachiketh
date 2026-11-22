#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
base="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')"
temp="$(mktemp -d)"
temp="$(cd "$temp" && pwd -P)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/scripts"
for file in merge-gate.ts bin.ts agent-verify.sh; do
  git show "$base:scripts/$file" > "$temp/scripts/$file"
done
chmod +x "$temp/scripts/agent-verify.sh"
MERGE_GATE_BASE_SHA="$base" MERGE_GATE_CHECKOUT_ROOT="$root" MERGE_GATE_VERIFY_SCRIPT="$temp/scripts/agent-verify.sh" node "$temp/scripts/merge-gate.ts" "$@"
