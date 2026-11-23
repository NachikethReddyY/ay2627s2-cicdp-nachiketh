#!/usr/bin/env bash
# Deploys one image to a Render service. Usage: scripts/render-deploy.sh <hook-url> <image-ref> [service-id]
# With RENDER_API_KEY and a service id it calls Render's deploys API, which also saves the image on the service,
# so a later settings change redeploys this image and not an old one. Otherwise it uses the deploy hook, which
# deploys the image without saving it. The hook URL and the API key are secrets and are never printed.
set -euo pipefail

hook=${1:-}
image=${2:?image ref required}
service=${3:-}

if [[ -n ${RENDER_API_KEY:-} && -n $service ]]; then
  if [[ ! $image =~ ^[A-Za-z0-9._/:@-]+$ ]]; then
    echo "FAIL: image ref has unexpected characters" >&2
    exit 1
  fi
  base=${RENDER_API_BASE:-https://api.render.com}
  curl -fsS --max-time 30 -X POST "$base/v1/services/$service/deploys" \
    -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"clearCache\":\"do_not_clear\",\"imageUrl\":\"$image\"}" -o /dev/null
  echo "requested Render API deploy for $image on $service; the saved image is updated"
  exit 0
fi

if [[ -z $hook ]]; then
  echo "FAIL: Render deploy hook is empty; set the production environment secret, or set RENDER_API_KEY with a service id" >&2
  exit 1
fi

curl -fsS --max-time 30 -X POST -G --data-urlencode "imgURL=$image" "$hook" -o /dev/null
echo "requested Render deploy for $image through the hook; the saved image is not updated"
