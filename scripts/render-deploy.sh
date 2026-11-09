#!/usr/bin/env bash
# Asks Render to deploy one image through its deploy hook. Usage: scripts/render-deploy.sh <hook-url> <image-ref>
# The hook URL carries a secret, so it is never printed.
set -euo pipefail

hook=${1:-}
image=${2:?image ref required}

if [[ -z $hook ]]; then
  echo "FAIL: Render deploy hook is empty; set the staging environment secret" >&2
  exit 1
fi

curl -fsS --max-time 30 -X POST -G --data-urlencode "imgURL=$image" "$hook" -o /dev/null
echo "requested Render deploy for $image"
