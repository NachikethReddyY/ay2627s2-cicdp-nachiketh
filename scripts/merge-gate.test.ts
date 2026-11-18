import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, REQUIRED_CHECKS, sensitivePaths, type GateOptions, type PullRequest } from "./merge-gate.ts";

const passing = REQUIRED_CHECKS.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" }));
const green: PullRequest = {
  state: "OPEN",
  isDraft: false,
  headRefOid: "abc123",
  reviewDecision: null,
  mergeable: "MERGEABLE",
  files: [{ path: "apps/web/src/pages/Home.tsx" }],
  statusCheckRollup: passing,
};
const open: GateOptions = { reviewResult: null, unresolvedThreads: 0, localHead: "abc123", worktreeClean: true };
const cleanReview = { status: "clean", head: "abc123" };

test("a green ordinary PR passes the gate", () => {
  assert.deepEqual(evaluateGate(green, open), []);
});

test("every required check must have reported and succeeded", () => {
  assert.equal(evaluateGate({ ...green, statusCheckRollup: [] }, open).length, REQUIRED_CHECKS.length);
  assert.equal(evaluateGate({ ...green, statusCheckRollup: passing.slice(0, 2) }, open).length, REQUIRED_CHECKS.length - 2);
  const skipped = passing.map((c) => (c.name === "e2e" ? { ...c, conclusion: "SKIPPED" } : c));
  assert.equal(evaluateGate({ ...green, statusCheckRollup: skipped }, open).length, 1);
  const failing = passing.map((c) => (c.name === "unit" ? { ...c, conclusion: "FAILURE" } : c));
  assert.ok(evaluateGate({ ...green, statusCheckRollup: failing }, open).length >= 1);
  const pending = [...passing.slice(1), { name: "lint", status: "IN_PROGRESS" }];
  assert.ok(evaluateGate({ ...green, statusCheckRollup: pending }, open).length >= 1);
});

test("an unknown mergeable state blocks, as do drafts, conflicts, change requests and open threads", () => {
  assert.equal(evaluateGate({ ...green, mergeable: "UNKNOWN" }, open).length, 1);
  assert.equal(evaluateGate({ ...green, mergeable: "CONFLICTING" }, open).length, 1);
  assert.equal(evaluateGate({ ...green, isDraft: true }, open).length, 1);
  assert.equal(evaluateGate({ ...green, reviewDecision: "CHANGES_REQUESTED" }, open).length, 1);
  assert.equal(evaluateGate(green, { ...open, unresolvedThreads: 2 }).length, 1);
});

test("local verification must match the PR head and a clean tree", () => {
  assert.equal(evaluateGate(green, { ...open, localHead: "zzz999" }).length, 1);
  assert.equal(evaluateGate(green, { ...open, worktreeClean: false }).length, 1);
});

test("sensitive paths need a clean review of this exact head commit", () => {
  const pr = { ...green, files: [{ path: "apps/api/src/auth/guards.ts" }, { path: "apps/web/src/main.tsx" }] };
  assert.equal(evaluateGate(pr, open).length, 1);
  assert.deepEqual(evaluateGate(pr, { ...open, reviewResult: cleanReview }), []);
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { status: "findings", head: "abc123" } }).length, 1);
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { status: "incomplete", head: "abc123" } }).length, 1);
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { status: "clean", head: "other" } }).length, 1);
});

test("sensitive path classes include auth guards, guardrails and repo rules", () => {
  const paths = [
    "apps/api/drizzle/0001_x.sql",
    ".github/workflows/ci.yml",
    ".github/CODEOWNERS",
    "infra/docker/api.Dockerfile",
    "services/sandbox/x.py",
    "apps/api/src/trpc/trpc.ts",
    "apps/api/src/access.ts",
    "apps/api/src/env.ts",
    "apps/api/src/sandbox/docker.ts",
    "apps/api/src/parts/router.ts",
    ".oxlintrc.json",
    "apps/web/eslint.config.js",
    "apps/web/eslint.allowlists.js",
    "scripts/check-comments.ts",
    "scripts/agent-review.ts",
    "scripts/revert-rate.ts",
    "REVIEW.md",
    "AGENTS.md",
    "package.json",
    "pnpm-workspace.yaml",
    "apps/web/vercel.json",
    "tools/validator/src/db.ts",
  ];
  assert.equal(sensitivePaths(paths).length, paths.length);
  assert.deepEqual(sensitivePaths(["docs/plan.md", "apps/web/src/main.tsx", "apps/web/src/pages/Home.tsx"]), []);
});

test("a high revert rate stops self-merging, a low or unknown one does not", () => {
  assert.equal(evaluateGate(green, { ...open, revertRate: 0.08 }).length, 1);
  assert.deepEqual(evaluateGate(green, { ...open, revertRate: 0.02 }), []);
  assert.deepEqual(evaluateGate(green, { ...open, revertRate: null }), []);
});
