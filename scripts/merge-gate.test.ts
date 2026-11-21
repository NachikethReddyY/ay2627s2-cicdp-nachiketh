import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStillCurrent, changedDuringReview, finalGateReasons, changedFiles, readSnapshot, finalPreMergeReasons, evaluateGate, REQUIRED_CHECKS, runTrustedReview, trustedReviewProcess, sensitivePaths, verifyEnv, type GateOptions, type PullRequest } from "./merge-gate.ts";

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
const open: GateOptions = { reviewResult: null, author: "claude", unresolvedThreads: 0, localHead: "abc123", worktreeClean: true, currentBase: "base111" };
const cleanReview = { status: "clean", head: "abc123", base: "base111", author: "claude", reviewer: "codex" };

test("the reviewed base must equal both the local and the remote main tip", () => {
  assert.deepEqual(baseStillCurrent("b1", "b1", "b1"), []);
  for (const [review, local, remote] of [["b1", "b2", "b1"], ["b1", "b1", "b2"], ["", "", ""], ["b1", "", "b1"], ["b1", "b1", ""]] as const) {
    const reasons = baseStillCurrent(review, local, remote);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0] ?? "", /fetch main and re-run the gate/);
  }
});

test("a change request, failing check or unresolved thread that appears after the review blocks the merge", () => {
  const { files: _files, ...ready } = green;
  const final = { author: "claude" as const, unresolvedThreads: 0, localHead: "abc123", worktreeClean: true };
  assert.deepEqual(finalGateReasons(ready, final), []);
  assert.equal(finalGateReasons({ ...ready, reviewDecision: "CHANGES_REQUESTED" }, final).length, 1);
  assert.ok(finalGateReasons({ ...ready, statusCheckRollup: passing.map((c) => (c.name === "unit" ? { ...c, conclusion: "FAILURE" } : c)) }, final).length > 0);
  assert.equal(finalGateReasons(ready, { ...final, unresolvedThreads: 1 }).length, 1);
  assert.equal(finalGateReasons({ ...ready, mergeable: "CONFLICTING" }, final).length, 1);
});

test("ordinary and sensitive changes require the bootstrap base in the last GitHub snapshot", () => {
  const calls: string[] = [];
  const reader = {
    localHead: () => (calls.push("head"), green.headRefOid),
    worktreeClean: () => (calls.push("tree"), true),
    localMain: () => (calls.push("main"), "base111"),
    snapshot: () => (calls.push("github"), { pr: green, remoteMain: "base111", unresolvedThreads: 0 }),
  };
  assert.deepEqual(finalPreMergeReasons(reader, green, "base111"), []);
  assert.deepEqual(calls, ["head", "tree", "main", "github"]);
  for (const change of [
    { remoteMain: "base222" },
    { unresolvedThreads: 1 },
    { pr: { ...green, reviewDecision: "CHANGES_REQUESTED" } },
    { pr: { ...green, statusCheckRollup: [] } },
    { pr: { ...green, headRefOid: "head222" } },
    { pr: { ...green, baseRefName: "release" } },
  ]) {
    assert.ok(finalPreMergeReasons({ ...reader, snapshot: () => ({ ...reader.snapshot(), ...change }) }, green, "base111").length > 0);
  }
  assert.ok(finalPreMergeReasons({ ...reader, localMain: () => "base222" }, green, "base111").length > 0);
});

test("GitHub samples main, head checks and review state together, including later pages", () => {
  const page = <T,>(nodes: T[], endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } });
  const calls: string[][] = [];
  const snapshot = readSnapshot("123", (args) => {
    calls.push(args);
    const query = args.find((arg) => arg.startsWith("query=")) ?? "";
    const final = query.includes("threads1:") && query.includes("checks1:");
    const checks = {
      checks0: page(passing.slice(0, 3), "checks-next"),
      ...(final && { checks1: page(passing.slice(3)) }),
    };
    return JSON.stringify({ data: { repository: {
      main: { target: { oid: "base111" } },
      pullRequest: {
        ...green,
        threads0: page([{ isResolved: !final }], "threads-next"),
        ...(final && { threads1: page([{ isResolved: false }]) }),
        commits: { nodes: [{ commit: { oid: green.headRefOid, statusCheckRollup: checks } }] },
      },
    } } });
  });
  for (const args of calls) {
    const query = args.find((arg) => arg.startsWith("query=")) ?? "";
    for (const field of ["refs/heads/main", "headRefOid", "statusCheckRollup", "reviewDecision", "reviewThreads"]) assert.ok(query.includes(field));
  }
  assert.ok(calls.at(-1)?.some((arg) => arg.includes('threads1:reviewThreads(first:100,after:"threads-next")') && arg.includes('checks1:contexts(first:100,after:"checks-next")')));
  assert.equal(snapshot.unresolvedThreads, 2);
  assert.deepEqual(snapshot.pr.statusCheckRollup, passing);
  assert.equal(snapshot.remoteMain, "base111");
});

test("a partial snapshot, missing continuation or checks for another head stop the gate", () => {
  const done = { hasNextPage: false, endCursor: null };
  const page = (oid: string, pageInfo = done, errors?: unknown[]) => JSON.stringify({
    errors,
    data: { repository: { main: { target: { oid: "base111" } }, pullRequest: {
      ...green,
      threads0: { nodes: [], pageInfo },
      commits: { nodes: [{ commit: { oid, statusCheckRollup: { checks0: { nodes: passing, pageInfo: done } } } }] },
    } } },
  });
  assert.throws(() => readSnapshot("123", () => page(green.headRefOid, done, [{}])), /incomplete/i);
  assert.throws(() => readSnapshot("123", () => page("other")), /different commits/);
  assert.throws(() => readSnapshot("123", () => page(green.headRefOid, { hasNextPage: true, endCursor: null })), /pagination/i);
});

test("classification includes both sides of renames between the pinned commits", () => {
  const root = mkdtempSync(join(tmpdir(), "merge-gate-files-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(root, "REVIEW.md"), "Guide");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("mv", "REVIEW.md", "guide\nnotes.md");
    git("commit", "-qm", "move");
    const head = git("rev-parse", "HEAD");
    git("checkout", "-q", base);
    git("update-ref", "refs/remotes/origin/main", head);
    assert.deepEqual(changedFiles(root, base, head), [{ path: "REVIEW.md" }, { path: "guide\nnotes.md" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a sensitive review must be pinned to the base commit the PR will merge into", () => {
  const pr = { ...green, files: [{ path: ".github/workflows/ci.yml" }] };
  assert.deepEqual(evaluateGate(pr, { ...open, reviewResult: cleanReview }), []);
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { ...cleanReview, base: "moved" } }).length, 1);
  assert.equal(evaluateGate(pr, { ...open, reviewResult: { ...cleanReview, base: undefined } }).length, 1);
  assert.equal(evaluateGate(pr, { ...open, currentBase: undefined, reviewResult: cleanReview }).length, 1);
});

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

test("each dependency lockfile requires strict review by itself", () => {
  for (const path of ["pnpm-lock.yaml", "services/engine/uv.lock"]) {
    const pr = { ...green, files: [{ path }] };
    assert.match(evaluateGate(pr, open).join("\n"), /touches sensitive paths/, path);
    assert.deepEqual(evaluateGate(pr, { ...open, reviewResult: cleanReview }), []);
  }
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

test("sensitive reviews reject inconsistent author and reviewer metadata", () => {
  const pr = { ...green, files: [{ path: "scripts/agent-review.ts" }] };
  for (const reviewResult of [
    { status: "clean", head: "abc123" },
    { ...cleanReview, reviewer: "claude" },
    { ...cleanReview, author: "unknown" },
    { ...cleanReview, reviewer: "unknown" },
  ]) assert.ok(evaluateGate(pr, { ...open, reviewResult }).length > 0);
});

test("strict Codex unavailability and inconsistent metadata have explicit diagnostics", () => {
  const pr = { ...green, files: [{ path: "scripts/agent-review.ts" }] };
  assert.match(evaluateGate(pr, { ...open, reviewResult: { ...cleanReview, status: "incomplete", reason: "strict review is unavailable for Codex" } }).join(" "), /strict Codex review is unavailable/);
  assert.match(evaluateGate(pr, { ...open, reviewResult: { ...cleanReview, author: "codex" } }).join(" "), /metadata is inconsistent/);
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

test("trusted review runner receives the base script, author, the local base ref and an isolated ledger", async () => {
  let argsSeen: string[] = [];
  const result = await runTrustedReview("/trusted/agent-review.ts", "/checkout", "claude", "base111", (file, args, root) => {
    assert.equal(file, process.execPath);
    assert.equal(root, "/checkout");
    argsSeen = args;
    return JSON.stringify(cleanReview);
  });
  assert.deepEqual(result, cleanReview);
  assert.deepEqual(argsSeen.slice(0, 8), ["/trusted/agent-review.ts", "--base", "base111", "--author", "claude", "--json", "--no-index", "--strict"]);
  assert.ok(!argsSeen.includes("--pr"));
  assert.match(argsSeen[9] ?? "", /merge-gate-review-/);
  assert.equal(await runTrustedReview("/trusted/agent-review.ts", "/checkout", "claude", "base111", () => "invalid"), null);
});

test("a review that exits non-zero with findings or incomplete is reported as that result, not as a tooling failure", async () => {
  const exited = (stdout: string) => () => {
    throw Object.assign(new Error("exit 1"), { stdout });
  };
  const findings = { status: "findings", head: "abc123", author: "claude", reviewer: "codex" };
  const incomplete = { ...findings, status: "incomplete" };
  assert.deepEqual(await runTrustedReview("/t/agent-review.ts", "/c", "claude", "b", exited(JSON.stringify(findings))), findings);
  assert.deepEqual(await runTrustedReview("/t/agent-review.ts", "/c", "claude", "b", exited(JSON.stringify(incomplete))), incomplete);
  assert.equal(await runTrustedReview("/t/agent-review.ts", "/c", "claude", "b", exited("not json")), null);
  assert.equal(await runTrustedReview("/t/agent-review.ts", "/c", "claude", "b", () => { throw new Error("trusted review timed out"); }), null);
  assert.equal(await runTrustedReview("/t/agent-review.ts", "/c", "claude", "b", () => {
    throw new Error("spawn failed");
  }), null);
});

test("a clean review requires a successful process exit", async () => {
  assert.equal(await runTrustedReview("/t/agent-review.ts", "/c", "claude", "b", () => {
    throw Object.assign(new Error("review process ended unsuccessfully"), { stdout: JSON.stringify(cleanReview) });
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
    writeFileSync(join(root, "scripts/merge-gate.ts"), 'import { readFileSync } from "node:fs"; import { dirname, join } from "node:path"; process.stdout.write(process.env.MERGE_GATE_BASE_SHA + " " + readFileSync(join(dirname(process.argv[1]), "agent-review.ts"), "utf8"));');
    for (const file of ["revert-rate.ts", "bin.ts", "agent-verify.sh"]) writeFileSync(join(root, "scripts", file), "");
    writeFileSync(join(root, "scripts/agent-review.ts"), "trusted review");
    git("add", ".");
    git("commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(root, "scripts/agent-review.ts"), "forged review");
    const result = spawnSync("bash", ["scripts/merge-gate-bootstrap.sh"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, git("rev-parse", "HEAD").toString().trim() + " trusted review");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("trusted review process times out without exposing its output", async () => {
  const start = Date.now();
  await assert.rejects(trustedReviewProcess(process.execPath, ["-e", "process.stdout.write('private output'); setInterval(() => {}, 1000)"], process.cwd(), 200), (error: Error) => {
    assert.match(error.message, /timed out/);
    assert.doesNotMatch(error.message, /private output/);
    return true;
  });
  assert.ok(Date.now() - start < 5000);
});

test("trusted review cleans up its helper processes after the reviewer exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "merge-gate-helper-"));
  try {
    const review = [
      'const { spawn } = require("node:child_process");',
      'spawn(process.execPath, ["-e", \'setTimeout(() => require("node:fs").writeFileSync("finished", "fixture"), 400)\'], { stdio: "ignore" }).unref();',
      'process.stdout.write("done");',
    ].join("\n");
    assert.equal(await trustedReviewProcess(process.execPath, ["-e", review], root, 5000), "done");
    await new Promise((complete) => setTimeout(complete, 700));
    assert.equal(existsSync(join(root, "finished")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
