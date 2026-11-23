import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCiSummary, type WorkflowJob } from "./ci-summary.ts";

function job(name: string, conclusion = "success"): WorkflowJob {
  return {
    name,
    conclusion,
    started_at: "2026-11-23T05:00:00Z",
    completed_at: "2026-11-23T05:01:15Z",
    html_url: `https://example.com/jobs/${encodeURIComponent(name)}`,
  };
}

test("PR results link to logs and test evidence and omit the production section", () => {
  const summary = renderCiSummary([job("unit"), job("e2e"), job("Prod / Verify", "skipped")], "pull_request", "skipped", {
    apiCoverage: "API coverage: 89.4% lines, 87.0% branches",
    e2eResult: "12 passed, 0 failed, 0 flaky, 0 skipped",
    e2eReportUrl: "https://example.com/artifacts/12",
  });
  assert.match(summary, /\[unit\]\(https:\/\/example\.com\/jobs\/unit\) \| success \| 1m 15s/);
  assert.match(summary, /89\.4% lines, 87\.0% branches/);
  assert.match(summary, /12 passed.*\[Playwright report\]\(https:\/\/example\.com\/artifacts\/12\)/);
  assert.doesNotMatch(summary, /### Production|Needs attention/);
});

test("a failing check is called out and production shows as skipped on main", () => {
  const summary = renderCiSummary([job("lint"), job("e2e", "failure")], "push", "skipped");
  assert.match(summary, /\*\*Needs attention:\*\* \[e2e\]/);
  assert.match(summary, /\| Prod \/ Images \| skipped \| — \|/);
  assert.match(summary, /\| Prod \/ Verify \| skipped \| — \|/);
});

test("production failures are called out and later skipped jobs show no duration", () => {
  const summary = renderCiSummary(
    [job("Prod / Images"), job("Prod / Migrate", "timed_out"), job("Prod / Verify", "skipped")],
    "push",
    "failure",
  );
  assert.match(summary, /\*\*Needs attention:\*\* \[Prod \/ Migrate\]/);
  assert.match(summary, /\[Prod \/ Verify\].* \| skipped \| — \|/);
});
