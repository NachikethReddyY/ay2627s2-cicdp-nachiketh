import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANGED_FILES_JQ, changedDuringReview, evaluateGate, parseChangedFiles, REQUIRED_CHECKS, runTrustedReview, sensitivePaths, verifyEnv, type GateOptions, type PullRequest } from "./merge-gate.ts";

const passing = REQUIRED_CHECKS.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" }));
const green: PullRequest = {
  state: "OPEN",
  isDraft: false,
  headRefOid: "abc123",
  baseRefName: "main",
  reviewDecision: null,
  mergeable: "MERGEABLE",
  files: [{ path: "apps/web/src/pages/Home.tsx" }],
  statusCheckRollup: passing,
};
const open: GateOptions = { reviewResult: null, author: "claude", unresolvedThreads: 0, localHead: "abc123", worktreeClean: true };
const cleanReview = { status: "clean", head: "abc123", author: "claude", reviewer: "codex" };

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
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { ...cleanReview, status: "findings" } }).length, 1);
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { ...cleanReview, status: "incomplete" } }).length, 1);
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { ...cleanReview, head: "other" } }).length, 1);
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

test("a PR that does not target main is refused, since the review is pinned to main's diff", () => {
  const reasons = evaluateGate({ ...green, baseRefName: "LQ-103-gate-from-base" }, open);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0] ?? "", /targets LQ-103-gate-from-base.*retarget.*main/s);
  assert.deepEqual(evaluateGate(green, open), []);
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
    "apps/api/src/db/migrate-cli.ts",
    "apps/api/src/db/schema.ts",
    "apps/api/src/db/seed.ts",
    "apps/api/src/imports/runner.ts",
    "apps/api/src/media/service.ts",
    "apps/api/src/media/storage.ts",
    "packages/player-core/src/scrim.ts",
    "packages/ui-catalog/src/index.ts",
    "apps/web/src/player/live/Steps.tsx",
    "services/engine/Dockerfile",
    "services/engine/uv.lock",
    ".dockerignore",
    "apps/web/vite.config.ts",
    "neon.ts",
    "docker-compose.ci.yml",
    "e2e/playwright.config.ts",
    "e2e/tests/smoke.spec.ts",
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

test("a head or base that moves while the review runs is refused", () => {
  assert.deepEqual(changedDuringReview({ headRefOid: "a", baseRefName: "main" }, { headRefOid: "a", baseRefName: "main" }), []);
  assert.match(changedDuringReview({ headRefOid: "a", baseRefName: "main" }, { headRefOid: "b", baseRefName: "main" }).join(), /head changed/);
  assert.match(changedDuringReview({ headRefOid: "a", baseRefName: "main" }, { headRefOid: "a", baseRefName: "other" }).join(), /base changed/);
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
  const result = spawnSync(process.execPath, ["scripts/merge-gate.ts", "123", "--author", "claude"], { encoding: "utf8", env });
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
    run(source, "config", "commit.gpgsign", "false");
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
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(root, "scripts"));
    for (const file of ["merge-gate-bootstrap.sh", "merge-gate.ts", "revert-rate.ts", "bin.ts", "agent-verify.sh", "agent-review.ts"]) {
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

test("sensitive reviews reject forged or matching identities", () => {
  const pr = { ...green, files: [{ path: "scripts/agent-review.ts" }] };
  for (const reviewResult of [
    { status: "clean", head: "abc123" },
    { ...cleanReview, reviewer: "claude" },
    { ...cleanReview, author: "unknown" },
    { ...cleanReview, reviewer: "unknown" },
  ]) assert.ok(evaluateGate(pr, { ...open, reviewResult }).length > 0);
});

test("the old review result flag is rejected with migration guidance", () => {
  const result = spawnSync(process.execPath, ["scripts/merge-gate.ts", "123", "--review-result", "forged.json"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--review-result.*--author/s);
});

test("bootstrap extracts the base review script", () => {
  const bootstrap = readFileSync("scripts/merge-gate-bootstrap.sh", "utf8");
  assert.match(bootstrap, /for file in [^\n]*agent-review\.ts/);
});

test("trusted review runner receives the base script, author, PR and isolated ledger", () => {
  let argsSeen: string[] = [];
  const result = runTrustedReview("/trusted/agent-review.ts", "/checkout", "123", "claude", (file, args, root) => {
    assert.equal(file, process.execPath);
    assert.equal(root, "/checkout");
    argsSeen = args;
    return JSON.stringify(cleanReview);
  });
  assert.deepEqual(result, cleanReview);
  assert.deepEqual(argsSeen.slice(0, 8), ["/trusted/agent-review.ts", "--pr", "123", "--author", "claude", "--json", "--no-index", "--strict"]);
  assert.match(argsSeen[9] ?? "", /merge-gate-review-/);
  assert.equal(runTrustedReview("/trusted/agent-review.ts", "/checkout", "123", "claude", () => "invalid"), null);
});

test("a review that exits non-zero with findings or incomplete is reported as that result, not as a tooling failure", () => {
  const exited = (stdout: string) => () => {
    throw Object.assign(new Error("exit 1"), { stdout });
  };
  const findings = { status: "findings", head: "abc123", author: "claude", reviewer: "codex" };
  assert.deepEqual(runTrustedReview("/t/agent-review.ts", "/c", "1", "claude", exited(JSON.stringify(findings))), findings);
  assert.equal(runTrustedReview("/t/agent-review.ts", "/c", "1", "claude", exited("not json")), null);
  assert.equal(runTrustedReview("/t/agent-review.ts", "/c", "1", "claude", () => {
    throw new Error("spawn failed");
  }), null);
});

test("bootstrap supplies the review script from the base commit", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-gate-review-base-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(root, "scripts"));
    copyFileSync("scripts/merge-gate-bootstrap.sh", join(root, "scripts/merge-gate-bootstrap.sh"));
    writeFileSync(join(root, "scripts/merge-gate.ts"), 'import { readFileSync } from "node:fs"; import { dirname, join } from "node:path"; process.stdout.write(readFileSync(join(dirname(process.argv[1]), "agent-review.ts"), "utf8"));');
    for (const file of ["revert-rate.ts", "bin.ts", "agent-verify.sh"]) writeFileSync(join(root, "scripts", file), "");
    writeFileSync(join(root, "scripts/agent-review.ts"), "trusted review");
    git("add", ".");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(root, "scripts/agent-review.ts"), "forged review");
    const result = spawnSync("bash", ["scripts/merge-gate-bootstrap.sh"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "trusted review");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
