#!/usr/bin/env bash
# Checks scripts/render-deploy.sh: an empty hook fails loudly, and a real hook gets imgURL as a query parameter.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap '{ kill "${stub:-0}" && wait "${stub:-0}"; } 2>/dev/null || true; rm -rf "$work"' EXIT
failures=0

# An empty hook must fail before any request is made.
status=0
"$here/render-deploy.sh" "" ghcr.io/owner/learnquest-api:abc >/dev/null 2>&1 || status=$?
if [[ $status -eq 0 ]]; then
  echo "FAIL empty hook exits non-zero"
  failures=$((failures + 1))
else
  echo "PASS empty hook exits non-zero"
fi

# A stub hook records the request path and answers 200.
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
log="$work/requests.log"
python3 - "$port" "$log" <<'PY' &
import http.server, sys

port, log = int(sys.argv[1]), sys.argv[2]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        with open(log, "a") as f:
            f.write(self.path + "\n")
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
PY
stub=$!
for _ in $(seq 50); do
  curl -s -o /dev/null "http://127.0.0.1:$port/" && break
  sleep 0.1
done

"$here/render-deploy.sh" "http://127.0.0.1:$port/hook?key=secret" "ghcr.io/owner/learnquest-api:abc" >/dev/null
if grep -qi '^/hook?key=secret&imgURL=ghcr\.io%2fowner%2flearnquest-api%3aabc$' "$log"; then
  echo "PASS hook receives imgURL alongside the existing key"
else
  echo "FAIL hook request was: $(cat "$log" 2>/dev/null || echo none)"
  failures=$((failures + 1))
fi

((failures == 0)) || { echo "$failures case(s) failed"; exit 1; }
echo "all render-deploy tests passed"
