import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, sensitivePaths, type PullRequest } from "./merge-gate.ts";

const green: PullRequest = {
  state: "OPEN",
  isDraft: false,
  headRefOid: "abc",
  reviewDecision: null,
  mergeable: "MERGEABLE",
  files: [{ path: "apps/web/src/pages/Home.tsx" }],
  statusCheckRollup: [
    { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "unit", status: "COMPLETED", conclusion: "SUCCESS" },
  ],
};
const open = { sensitive: false, unresolvedThreads: 0 };

test("a green ordinary PR passes the gate", () => {
  assert.deepEqual(evaluateGate(green, open), []);
});

test("a failing, pending or missing check blocks the merge", () => {
  assert.equal(evaluateGate({ ...green, statusCheckRollup: [{ name: "e2e", status: "COMPLETED", conclusion: "FAILURE" }] }, open).length, 1);
  assert.equal(evaluateGate({ ...green, statusCheckRollup: [{ name: "e2e", status: "IN_PROGRESS" }] }, open).length, 1);
  assert.equal(evaluateGate({ ...green, statusCheckRollup: [] }, open).length, 1);
});

test("drafts, conflicts, change requests and open threads block the merge", () => {
  assert.equal(evaluateGate({ ...green, isDraft: true }, open).length, 1);
  assert.equal(evaluateGate({ ...green, mergeable: "CONFLICTING" }, open).length, 1);
  assert.equal(evaluateGate({ ...green, reviewDecision: "CHANGES_REQUESTED" }, open).length, 1);
  assert.equal(evaluateGate(green, { ...open, unresolvedThreads: 2 }).length, 1);
});

test("sensitive paths need an explicit flag", () => {
  const pr = { ...green, files: [{ path: "apps/api/src/auth/guards.ts" }, { path: "apps/web/src/main.tsx" }] };
  assert.equal(evaluateGate(pr, open).length, 1);
  assert.deepEqual(evaluateGate(pr, { ...open, sensitive: true }), []);
});

test("sensitive path classes", () => {
  const found = sensitivePaths([
    "apps/api/drizzle/0001_x.sql",
    ".github/workflows/ci.yml",
    "infra/docker/api.Dockerfile",
    "services/sandbox/x.py",
    "docs/plan.md",
    "apps/web/src/main.tsx",
  ]).map((s) => s.why);
  assert.deepEqual(found, ["database migration", "workflow", "infra", "sandbox boundary"]);
});

test("a high revert rate stops self-merging, a low or unknown one does not", () => {
  assert.equal(evaluateGate(green, { ...open, revertRate: 0.08 }).length, 1);
  assert.deepEqual(evaluateGate(green, { ...open, revertRate: 0.02 }), []);
  assert.deepEqual(evaluateGate(green, { ...open, revertRate: null }), []);
});
