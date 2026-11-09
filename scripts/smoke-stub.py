"""Stub API and web server for scripts/smoke.test.sh.

Usage: smoke-stub.py <port> <mode> <sha>
Modes: ok (everything correct), cold (API healthz 503 for the first three calls),
stale (API healthz reports an old sha), engine-stale (engine healthz reports an old sha),
open (protected route answers 200), down (API healthz always 503).
"""

import http.server
import json
import sys

port, mode, sha = int(sys.argv[1]), sys.argv[2], sys.argv[3]
healthz_calls = 0


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        global healthz_calls
        if self.path == "/api/healthz":
            healthz_calls += 1
            if mode == "down" or (mode == "cold" and healthz_calls <= 3):
                return self._send(503, {"error": {"code": "unavailable", "message": "starting"}})
            reported = "old-sha" if mode == "stale" else sha
            return self._send(200, {"ok": True, "sha": reported})
        if self.path == "/healthz":
            reported = "old-sha" if mode == "engine-stale" else sha
            return self._send(200, {"ok": True, "sha": reported})
        if self.path == "/api/readyz":
            return self._send(200, {"ok": True})
        if self.path == "/api/trpc/home.get":
            return self._send(200 if mode == "open" else 401, {})
        if self.path == "/":
            return self._send(200, b"<html></html>")
        return self._send(404, {})

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
