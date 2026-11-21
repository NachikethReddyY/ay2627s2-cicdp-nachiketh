import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANGED_FILES_JQ, evaluateGate, parseChangedFiles, REQUIRED_CHECKS, sensitivePaths, type GateOptions, type PullRequest } from "./merge-gate.ts";

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

test("sensitive paths cover grading, learner models, configuration and all scripts", () => {
  const paths = [
    "scripts/narrate.ts",
    "scripts/nested/new-tool.ts",
    "apps/api/src/games/grade.ts",
    "apps/api/src/attempts/machine.ts",
    "apps/api/src/dev/route.ts",
    "services/engine/learnquest_engine/guide.py",
    "services/engine/learnquest_engine/bkt.py",
    "services/engine/learnquest_engine/policy.py",
    "services/engine/learnquest_engine/learner.py",
    "apps/api/src/progress/mastery.ts",
    "apps/api/src/app.ts",
    "package.json",
    "apps/api/package.json",
    "packages/player-core/package.json",
    "e2e/scripts/ci.sh",
    "pnpm-lock.yaml",
    "apps/api/test/helpers.ts",
    "apps/api/test/helpers/database.ts",
    "apps/api/src/progress/games.ts",
    "packages/ui-catalog/src/blocks/game/public.ts",
    "services/engine/learnquest_engine/server.py",
    "apps/api/src/progress/collections.ts",
    "apps/api/src/progress/paths.ts",
    "apps/api/src/lint/route.ts",
    "apps/api/src/ai/service.ts",
    "apps/api/src/engine-client/learner.ts",
    "apps/api/src/engine-client/client.ts",
    "apps/api/src/progress/me.ts",
    "services/engine/learnquest_engine/schemas.py",
    "services/engine/learnquest_engine/config.py",
    "services/engine/learnquest_engine/new_module.py",
    "INSTRUCTIONS.md",
    "apps/api/src/imports/routes.ts",
    ".agents/skills/verify/SKILL.md",
    ".claude/skills/verify/SKILL.md",
  ];
  for (const path of paths) {
    assert.equal(sensitivePaths([path]).length, 1, `${path} must require sensitive review`);
  }
});

test("a rename reports its old path too, so moving a sensitive file out of its directory is still caught", () => {
  const files = parseChangedFiles("docs/moved.md\tscripts/merge-gate.ts\napps/web/src/a.ts\t\n");
  assert.deepEqual(files.map((f) => f.path).sort(), ["apps/web/src/a.ts", "docs/moved.md", "scripts/merge-gate.ts"]);
  assert.equal(sensitivePaths(files.map((f) => f.path)).length, 1);
});

test("the changed-files query asks GitHub for the old name of a renamed file", () => {
  assert.match(CHANGED_FILES_JQ, /previous_filename/);
});

test("a changed-file list one under GitHub's cap is accepted", () => {
  const rows = Array.from({ length: 2999 }, (_, i) => `f${i}.ts\t`).join("\n");
  assert.equal(parseChangedFiles(rows).length, 2999);
});

test("a changed-file list at GitHub's 3000 file cap is refused because it may be truncated", () => {
  const rows = Array.from({ length: 3000 }, (_, i) => `f${i}.ts\t`).join("\n");
  assert.throws(() => parseChangedFiles(rows), /3000.*smaller|split/i);
});

test("a high revert rate stops self-merging, a low or unknown one does not", () => {
  assert.equal(evaluateGate(green, { ...open, revertRate: 0.08 }).length, 1);
  assert.deepEqual(evaluateGate(green, { ...open, revertRate: 0.02 }), []);
  assert.deepEqual(evaluateGate(green, { ...open, revertRate: null }), []);
});
