#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "refusing to run: this checkout is shallow, so the revert rate may miss recent reverts; run git fetch --unshallow" >&2
  exit 2
fi
base="$(git rev-parse --verify 'refs/remotes/origin/main^{commit}')"
temp="$(mktemp -d)"
temp="$(cd "$temp" && pwd -P)"
trap 'rm -rf "$temp"' EXIT
mkdir -p "$temp/scripts"
for file in merge-gate.ts revert-rate.ts bin.ts agent-verify.sh agent-review.ts; do
  git show "$base:scripts/$file" > "$temp/scripts/$file"
done
chmod +x "$temp/scripts/agent-verify.sh"
MERGE_GATE_CHECKOUT_ROOT="$root" MERGE_GATE_VERIFY_SCRIPT="$temp/scripts/agent-verify.sh" node "$temp/scripts/merge-gate.ts" "$@"
