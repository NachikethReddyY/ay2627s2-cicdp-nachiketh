import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate, REQUIRED_CHECKS, sensitivePaths, verifyEnv, type GateOptions, type PullRequest } from "./merge-gate.ts";

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

test("skip-local is rejected before accessing the PR", () => {
  const result = spawnSync(process.execPath, ["scripts/merge-gate.ts", "123", "--skip-local"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--skip-local.*remove/i);
});

test("the gate refuses to run without the base verify script from the bootstrap", () => {
  const env = { ...process.env };
  delete env.MERGE_GATE_VERIFY_SCRIPT;
  const result = spawnSync(process.execPath, ["scripts/merge-gate.ts", "123"], { encoding: "utf8", env });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /merge-gate-bootstrap\.sh/);
});

test("agent:merge in package.json only prints the trusted command and exits", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.match(manifest.scripts["agent:merge"] ?? "", /^echo .* && exit 2$/);
});

test("verification drops GitHub token variables and uses an empty gh config, which is not isolation from keychain or git credentials", () => {
  const env = verifyEnv(
    { PATH: "/bin", GH_TOKEN: "x", GITHUB_TOKEN: "y", GH_ENTERPRISE_TOKEN: "z", GH_CONFIG_DIR: "/home/op/.config/gh" },
    "/checkout",
    "/empty",
  );
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_ENTERPRISE_TOKEN, undefined);
  assert.equal(env.GH_CONFIG_DIR, "/empty");
  assert.equal(env.MERGE_GATE_CHECKOUT_ROOT, "/checkout");
  assert.equal(env.PATH, "/bin");
});

test("the bootstrap refuses a shallow checkout because the revert rate needs full history", () => {
  const source = mkdtempSync(join(tmpdir(), "merge-gate-src-"));
  const shallow = mkdtempSync(join(tmpdir(), "merge-gate-shallow-"));
  try {
    const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
    run(source, "init", "-q");
    run(source, "config", "user.email", "test@example.com");
    run(source, "config", "user.name", "Test");
    for (const n of ["a", "b"]) {
      writeFileSync(join(source, n), n);
      run(source, "add", ".");
      run(source, "commit", "-qm", n);
    }
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${source}`, shallow], { stdio: "pipe" });
    const bootstrap = readFileSync("scripts/merge-gate-bootstrap.sh", "utf8");
    const result = spawnSync("bash", ["-s", "--", "123"], { cwd: shallow, input: bootstrap, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /shallow.*git fetch --unshallow/i);
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(shallow, { recursive: true, force: true });
  }
});

test("base bootstrap executes the base gate even when the checkout changes it", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-gate-base-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    mkdirSync(join(root, "scripts"));
    for (const file of ["merge-gate-bootstrap.sh", "merge-gate.ts", "revert-rate.ts", "bin.ts", "agent-verify.sh"]) {
      copyFileSync(join("scripts", file), join(root, "scripts", file));
    }
    git("add", ".");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(root, "scripts/merge-gate.ts"), 'process.stderr.write("untrusted gate executed\\n"); process.exit(0);\n');
    const bootstrap = git("show", "origin/main:scripts/merge-gate-bootstrap.sh");
    const result = spawnSync("bash", ["-s", "--", "123", "--skip-local"], { cwd: root, input: bootstrap, encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--skip-local.*remove/i);
    assert.doesNotMatch(result.stderr, /untrusted gate executed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
