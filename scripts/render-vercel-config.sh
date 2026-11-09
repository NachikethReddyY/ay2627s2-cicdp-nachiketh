#!/usr/bin/env bash
# Writes a copy of apps/web/vercel.json that points the /api rewrite, media-src and connect-src (https and wss)
# at another API origin. The committed file keeps the production host. Usage:
#   scripts/render-vercel-config.sh <api-origin> <out-file>
set -euo pipefail

origin=${1:?api origin required}
out=${2:?output path required}

if [[ ! $origin =~ ^https://[a-z0-9.-]+$ ]]; then
  echo "FAIL: API origin must be https://<host> with no path or trailing slash, got $origin" >&2
  exit 1
fi

prod_host=learnquest-api.onrender.com
host=${origin#https://}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sed -e "s#https://$prod_host#$origin#g" -e "s#wss://$prod_host#wss://$host#g" \
  "$root/apps/web/vercel.json" >"$out"

if grep -q "$prod_host" "$out"; then
  echo "FAIL: production API host still present in $out" >&2
  exit 1
fi
python3 -m json.tool "$out" >/dev/null
echo "wrote $out for $origin"
