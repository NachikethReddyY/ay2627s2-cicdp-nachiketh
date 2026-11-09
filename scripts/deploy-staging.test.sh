#!/usr/bin/env bash
# Checks the structure of .github/workflows/deploy-staging.yml: job order, the staging environment, the deploy
# concurrency group, pinned actions, minimal permissions, timeouts, and no expression interpolated into run:.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

uv run --no-project --python 3.12 --with pyyaml python - "$root/.github/workflows/deploy-staging.yml" <<'PY'
import re
import sys

import yaml

with open(sys.argv[1]) as f:
    wf = yaml.safe_load(f)

# PyYAML parses the bare key `on` as the boolean True.
triggers = wf.get(True, wf.get("on"))
jobs = wf["jobs"]
failures = []


def check(ok: bool, message: str) -> None:
    print(("PASS " if ok else "FAIL ") + message)
    if not ok:
        failures.append(message)


check(triggers.get("push", {}).get("branches") == ["main"], "triggers on push to main only")
check(wf.get("permissions") == {"contents": "read"}, "top-level permissions are contents: read")
check(wf["concurrency"] == {"group": "deploy-staging", "cancel-in-progress": False},
      "one deploy at a time, in-flight deploys are never cancelled")
check(jobs["build"].get("if") == "github.ref == 'refs/heads/main'", "build runs only for main")
check(jobs["migrate"].get("needs") == "build", "migrate waits for build")
check(sorted(jobs["deploy"].get("needs", [])) == ["build", "migrate"], "deploy waits for build and migrate")
check(jobs["smoke"].get("needs") == "deploy", "smoke waits for deploy")
for name in ("migrate", "deploy", "smoke"):
    check(jobs[name].get("environment") == "staging", f"{name} uses the staging environment")
for name, job in jobs.items():
    check("timeout-minutes" in job, f"{name} has timeout-minutes")

uses = [step["uses"] for job in jobs.values() for step in job["steps"] if "uses" in step]
unpinned = [u for u in uses if not re.search(r"@[0-9a-f]{40}$", u)]
check(not unpinned, f"every third-party action is pinned to a commit sha ({len(uses)} uses)")

run_blocks = [step["run"] for job in jobs.values() for step in job["steps"] if "run" in step]
interpolated = [r for r in run_blocks if "${{" in r]
check(not interpolated, "no expression is interpolated into run: blocks")

if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("all deploy-staging structure checks passed")
PY
