#!/usr/bin/env bash
# Checks the structure of .github/workflows/deploy-production.yml: job order, the production environment, the deploy
# concurrency group, pinned actions, minimal permissions, timeouts, and no expression interpolated into run:.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

uv run --no-project --python 3.12 --with pyyaml python - "$root/.github/workflows/deploy-production.yml" <<'PY'
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


check(set(triggers) == {"workflow_run"} and triggers["workflow_run"].get("workflows") == ["CI"] and triggers["workflow_run"].get("types") == ["completed"], "runs after CI completes")
check(wf.get("permissions") == {"contents": "read"}, "top-level permissions are contents: read")
check(wf["concurrency"] == {"group": "deploy-production", "cancel-in-progress": False},
      "one deploy at a time, in-flight deploys are never cancelled")
check(jobs["build"].get("if") == "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_repository.full_name == github.repository", "build runs only after successful CI push on this repo main")
check(jobs["migrate"].get("needs") == "build", "migrate waits for build")
check(sorted(jobs["deploy"].get("needs", [])) == ["build", "migrate"], "deploy waits for build and migrate")
check(jobs["smoke"].get("needs") == "deploy", "smoke waits for deploy")
for name in ("migrate", "deploy", "smoke"):
    check(jobs[name].get("environment") == "production", f"{name} uses the production environment")
for name, job in jobs.items():
    check("timeout-minutes" in job, f"{name} has timeout-minutes")

uses = [step["uses"] for job in jobs.values() for step in job["steps"] if "uses" in step]
unpinned = [u for u in uses if not re.search(r"@[0-9a-f]{40}$", u)]
check(not unpinned, f"every third-party action is pinned to a commit sha ({len(uses)} uses)")

run_blocks = [step["run"] for job in jobs.values() for step in job["steps"] if "run" in step]
interpolated = [r for r in run_blocks if "${{" in r]
check(not interpolated, "no expression is interpolated into run: blocks")
on_demand = [r for r in run_blocks if re.search(r"\bnpx\b", r)]
check(not on_demand, "no step resolves a package on demand with npx")

if failures:
    print(f"{len(failures)} check(s) failed")
    sys.exit(1)
print("all deploy-production structure checks passed")
PY
