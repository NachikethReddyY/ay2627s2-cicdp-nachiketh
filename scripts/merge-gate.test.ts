import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertBaseIsCurrent, changedFilesAgainstFreshMain, changedFilesFromGit, evaluateGate, parseRawDiffZ, REQUIRED_CHECKS, sensitivePaths, verifyEnv, type GateOptions, type PullRequest } from "./merge-gate.ts";

function regularFile(path: string) {
  return { path, oldMode: "100644", newMode: "100644" };
}

const passing = REQUIRED_CHECKS.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" }));
const green: PullRequest = {
  state: "OPEN",
  isDraft: false,
  headRefOid: "abc123",
  reviewDecision: null,
  mergeable: "MERGEABLE",
  files: [regularFile("docs/plan.md")],
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
  const pr = { ...green, files: ["apps/api/src/auth/guards.ts", "apps/web/src/main.tsx"].map(regularFile) };
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
  assert.equal(sensitivePaths(paths.map(regularFile)).length, paths.length);
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
    "apps/api/test/security/fixtures/injection.json",
    "apps/api/test/auth.test.ts",
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
    assert.equal(sensitivePaths([regularFile(path)]).length, 1, `${path} must require sensitive review`);
  }
});

const EXPECTED_SENSITIVE = [
  "apps/api/src/auth/session.ts",
  "apps/api/src/trpc/trpc.ts",
  "apps/api/src/some-new-feature/handler.ts",
  "apps/api/src/index.ts",
  "services/engine/learnquest_engine/bkt.py",
  "services/engine/tests/test_bkt.py",
  "packages/player-core/src/replay.ts",
  "packages/ui-catalog/src/blocks/quiz/Quiz.tsx",
  "packages/ui-catalog/src/blocks/game/public.ts",
  "e2e/tests/smoke.spec.ts",
  "apps/web/src/player/Player.tsx",
  "apps/web/vite.config.ts",
  "apps/web/package.json",
  "apps/web/eslint.config.js",
  "docs/agents/README.md",
  "scripts/merge-gate.ts",
  "AGENTS.md",
  "REVIEW.md",
  "pnpm-lock.yaml",
  ".github/workflows/ci.yml",
  "services/engine/uv.lock",
  "apps/api/src/billing/fixtures/sample.json",
  "services/engine/tests/fixtures/part_learn_doc_bad.json",
  "services/engine/tests/fixtures/lesson.json",
  "services/engine/tests/fixtures/lesson.yaml",
  ".pnpmfile.mjs",
  ".pnpmfile.cjs",
  "apps/web/src/lib/auth.ts",
  "apps/web/src/lib/api.ts",
  "apps/web/src/pages/Login.tsx",
  "worlds/codequest/manifest.json",
  "worlds/loops/lessons/loops-1.json",
  "worlds/new-world/lessons/x.json",
  "apps/web/src/main.tsx",
  "apps/web/index.html",
  "apps/web/postcss.config.mjs",
  "apps/web/tailwind.config.ts",
  "apps/web/tsconfig.json",
  "apps/web/tsconfig.app.json",
  "apps/web/.env.production",
  "apps/web/.env.example",
  ".gitmodules",
  "apps/web/src/index.css",
  "apps/web/public/robots.txt",
  "apps/web/public/x.html",
  "apps/web/src/pages/Login.ts",
  "apps/web/src/pages/Login.tsx",
  "apps/web/src/pages/Login.module.css",
  "apps/web/src/components/Login.js",
  "apps/web/src/blocks/quiz/Quiz.tsx",
  "apps/web/src/gitBranch.d.ts",
  "apps/web/components.json",
  "apps/web/vercel.ts",
  ".gitattributes",
  ".gitignore",
  "apps/web/.gitignore",
  ".dockerignore",
  "apps/api/.dockerignore",
  "AGENTS.override.md",
  "apps/api/AGENTS.override.md",
  "compose.yaml",
  "compose.yml",
  "compose.ci.yml",
  "infra/compose.prod.yaml",
  "docker-compose.ci.yml",
  "docker-compose",
  "vercel.toml",
  ".vercelignore",
  "apps/web/.vercelignore",
  "postcss.config.mjs",
  "apps/postcss.config.cjs",
  "apps/api/tsconfig.json",
  "tsconfig.base.json",
  "packages/ui-catalog/tsconfig.build.json",
  "apps/web/middleware.ts",
  "middleware.js",
  "apps/api/vitest.config.ts",
  "packages/player-core/tailwind.config.js",
  "babel.config.cjs",
  "apps/web/src/vite.config.mts",
  "apps/web/api/hello.ts",
  "api/handler.ts",
  "spikes/sse-rewrite/web/vercel.json",
  ".eslintignore",
  "apps/web/.prettierignore",
  ".oxlintrc.jsonc",
  "apps/api/AGENTS.md",
  "packages/CLAUDE.md",
  ".cursor/rules/x.mdc",
  "apps/web/.cursor/rules.md",
  "apps/web/.github/CODEOWNERS",
  ".env",
  ".env.local",
  "apps/api/.env",
  "apps/api/.env.production",
  "services/engine/.env.test",
  ".babelrc",
  "apps/web/.babelrc.json",
  ".eslintrc.cjs",
  "apps/api/.eslintrc.json",
  ".npmrc",
  "apps/web/.npmrc",
  ".nvmrc",
  ".prettierrc.yaml",
  ".node-version",
  ".tool-versions",
  ".husky/pre-commit",
  ".macroscope/review.yaml",
  "apps/web/scripts/build-assets.mjs",
  "spikes/litellm-advisory/check.py",
  "apps/web/src/blocks/game/api.ts",
  "apps/web/src/blocks/game/Shell.tsx",
  "services/engine/tests/fixtures/test_x.py",
  "packages/ui-catalog/fixtures/setup.ts",
  "e2e/fixtures/helper.js",
  "e2e/__fixtures__/run.sh",
  "apps/web/src/pages/Home.tsx",
  "apps/web/src/components/Button.tsx",
  "apps/web/src/components/Button.test.tsx",
  "apps/web/src/components/Button.module.css",
  "apps/web/src/pages/Home.test.tsx",
  "apps/web/src/pages/home/Hero.tsx",
  "apps/api/README.md",
  "services/engine/README.md",
  "packages/ui-catalog/README.md",
  "packages/player-core/src/__fixtures__/timeline.json",
  "packages/ui-catalog/src/blocks/quiz/__snapshots__/Quiz.test.tsx.snap",
  "e2e/fixtures/learner.json",
  "e2e/fixtures/avatar.png",
  "packages/ui-catalog/fixtures/notes.txt",
  "packages/ui-catalog/src/__snapshots__/a.snap",
  "packages/ui-catalog/fixtures/quiz.json",
];

const EXPECTED_NOT_SENSITIVE = [
  "README.md",
  "docs/plan.md",
  "docs/feature-map.md",
  "docs/adr/0001-object-storage.md",
  "docs/adr/0002-visual-trust-model.md",
  "docs/adr/0003-engine-boundary.md",
  "docs/adr/0004-coverage-gate.md",
];

const reviewRequiredGroups = {
  "web build and verification inputs": [
    "apps/web/src/pages/landing.css",
    "apps/web/src/components/Disclosure.test.tsx",
    "apps/web/src/pages/Home.spec.ts",
  ],
  "shared login dependencies": [
    "apps/web/src/components/ui/breadcrumb.tsx",
    "apps/web/src/pages/landing/Logo.tsx",
  ],
  "fixtures and public inputs": [
    "packages/ui-catalog/fixtures/quiz.json",
    "apps/web/public/__fixtures__/sample.svg",
    "apps/web/public/README.md",
  ],
  "nested Turbo configuration and unclassified paths": [
    "tools/new-workspace/turbo.json",
    "docs/example/turbo.jsonc",
    "new-workspace/build.ts",
  ],
};

for (const [group, paths] of Object.entries(reviewRequiredGroups)) {
  test(`the merge gate requires review for ${group}`, () => {
    for (const path of paths) {
      const pr = { ...green, files: [regularFile(path)] };
      assert.match(evaluateGate(pr, open).join("\n"), /--review-result/, path);
    }
  });
}

test("a documentation exception requires ordinary file modes on both sides of the change", () => {
  const path = "docs/plan.md";
  for (const [oldMode, newMode] of [["000000", "100644"], ["100644", "100644"], ["100644", "000000"]]) {
    const pr = { ...green, files: [{ path, oldMode, newMode }] };
    assert.deepEqual(evaluateGate(pr, open), []);
  }
  for (const mode of ["100755", "120000", "160000"]) {
    for (const [oldMode, newMode] of [["000000", mode], [mode, "100644"], ["100644", mode], [mode, "000000"]]) {
      const pr = { ...green, files: [{ path, oldMode, newMode }] };
      assert.match(evaluateGate(pr, open).join("\n"), /--review-result/, `${oldMode} -> ${newMode}`);
    }
  }
});

test("the expected sensitive and not-sensitive path lists stay as agreed", () => {
  for (const path of EXPECTED_SENSITIVE) {
    assert.equal(sensitivePaths([regularFile(path)]).length, 1, `${path} must be sensitive`);
  }
  for (const path of EXPECTED_NOT_SENSITIVE) {
    assert.deepEqual(sensitivePaths([regularFile(path)]), [], `${path} must not be sensitive`);
  }
});

test("a brand-new file under a deny-by-default directory is sensitive", () => {
  const fresh = [
    "apps/api/src/brand-new/thing.ts",
    "services/engine/learnquest_engine/new_module.py",
    "services/engine/new_top_level.py",
    "packages/new-pkg/src/x.ts",
    "e2e/tests/new.spec.ts",
  ];
  for (const path of fresh) {
    assert.equal(sensitivePaths([regularFile(path)]).length, 1, `${path} must be sensitive by default`);
  }
});

test("documentation and fixture names outside the prose allowlist require review", () => {
  const stillSensitive = [
    "apps/web/src/player/x.tsx",
    "apps/web/src/player/fixtures/steps.json",
    "apps/web/vite.config.ts",
    "apps/web/package.json",
    "apps/web/eslint.config.js",
    "docs/agents/README.md",
    "docs/agents/fixtures/x.md",
    "scripts/README.md",
    ".github/README.md",
    "services/engine/learnquest_engine/prompts/fixtures/x.md",
  ];
  for (const path of stillSensitive) {
    assert.equal(sensitivePaths([regularFile(path)]).length, 1, `${path} must stay sensitive`);
  }
});

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-git-"));
  gitIn(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "seed.txt"), "seed");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "seed");
  gitIn(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
}

test("raw Git records preserve both modes and every path, including rename and copy sources", () => {
  const out = [
    ":100644 100644 abc abc R100", "old.ts", "docs/plan.md",
    ":100644 100755 abc abc C075", "copy.ts", "new.ts",
    ":000000 100644 000 def A", "added.ts",
    ":120000 100644 abc def T", "changed.md",
    ":100755 000000 def 000 D", "deleted.md", "",
  ].join("\0");
  assert.deepEqual(parseRawDiffZ(out), [
    regularFile("old.ts"), regularFile("docs/plan.md"),
    { path: "copy.ts", oldMode: "100644", newMode: "100755" },
    { path: "new.ts", oldMode: "100644", newMode: "100755" },
    { path: "added.ts", oldMode: "000000", newMode: "100644" },
    { path: "changed.md", oldMode: "120000", newMode: "100644" },
    { path: "deleted.md", oldMode: "100755", newMode: "000000" },
  ]);
});

test("incomplete or unrecognized raw Git records stop classification", () => {
  assert.deepEqual(parseRawDiffZ(""), []);
  assert.throws(() => parseRawDiffZ(":100644 100644 abc abc M\0path"), /incomplete/);
  assert.throws(() => parseRawDiffZ("unknown\0path\0"), /unrecognized/);
  assert.throws(() => parseRawDiffZ(":100644 100644 abc abc R100\0old.ts\0"), /missing path/);
});

test("a file renamed out of a sensitive directory reports its old path", () => {
  const dir = tempRepo();
  try {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "tool.ts"), "export const x = 1;\n".repeat(20));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "tool");
    gitIn(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(dir, "docs"));
    gitIn(dir, "mv", "scripts/tool.ts", "docs/plan.md");
    gitIn(dir, "commit", "-q", "-m", "move");
    const files = changedFilesFromGit(dir, gitIn(dir, "rev-parse", "HEAD"));
    assert.deepEqual(files.map((f) => f.path).sort(), ["docs/plan.md", "scripts/tool.ts"]);
    assert.equal(sensitivePaths(files).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a copied file reports its unchanged source as well as its destination", () => {
  const dir = tempRepo();
  try {
    writeFileSync(join(dir, "seed.txt"), "A sample shared test fixture.\n".repeat(20));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "prepare fixture");
    gitIn(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(dir, "copy.txt"), readFileSync(join(dir, "seed.txt")));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "copy fixture");
    const files = changedFilesFromGit(dir, gitIn(dir, "rev-parse", "HEAD"));
    assert.deepEqual(files.map((file) => file.path).sort(), ["copy.txt", "seed.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("more than 300 changed files are all listed", () => {
  const dir = tempRepo();
  try {
    mkdirSync(join(dir, "many"));
    for (let i = 0; i < 450; i++) writeFileSync(join(dir, "many", `f${i}.txt`), String(i));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "many");
    assert.equal(changedFilesFromGit(dir, gitIn(dir, "rev-parse", "HEAD")).length, 450);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("paths with spaces, newlines and non-ASCII survive -z parsing", () => {
  const dir = tempRepo();
  const names = ["with space.txt", "new\nline.txt", "café-日本.txt", "tab\there.txt"];
  try {
    for (const name of names) writeFileSync(join(dir, name), "x");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "odd");
    const files = changedFilesFromGit(dir, gitIn(dir, "rev-parse", "HEAD")).map((f) => f.path);
    assert.deepEqual(files.sort(), [...names].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a head commit missing from the local repo is refused with the fix in the message", () => {
  const dir = tempRepo();
  try {
    assert.throws(() => changedFilesFromGit(dir, "0123456789012345678901234567890123456789"), /git fetch origin.*check out/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("a changed gitlink is reported even when .gitmodules says to ignore the submodule", () => {
  const dir = tempRepo();
  try {
    writeFileSync(join(dir, ".gitmodules"), '[submodule "sub"]\n\tpath = sub\n\turl = ../sub\n\tignore = all\n');
    gitIn(dir, "add", "-A");
    gitIn(dir, "update-index", "--add", "--cacheinfo", "160000,1111111111111111111111111111111111111111,sub");
    gitIn(dir, "commit", "-q", "-m", "gitlink");
    const files = changedFilesFromGit(dir, gitIn(dir, "rev-parse", "HEAD")).map((f) => f.path);
    assert.ok(files.includes("sub"), "the gitlink must be listed");
    assert.ok(files.includes(".gitmodules"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stale local origin/main is refused with the fetch command in the message", () => {
  const sha = "a".repeat(40);
  assert.doesNotThrow(() => assertBaseIsCurrent(sha, sha));
  assert.throws(() => assertBaseIsCurrent(sha, "b".repeat(40)), /git fetch origin \+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.throws(() => assertBaseIsCurrent("", sha), /git fetch origin/);
  assert.throws(() => assertBaseIsCurrent(sha, ""), /git fetch origin/);
  assert.throws(() => assertBaseIsCurrent("", ""), /git fetch origin/);
});

test("the diff runs against the main SHA that was verified", () => {
  const calls: string[][] = [];
  const base = "a".repeat(40);
  const run = (args: string[]): string => {
    calls.push(args);
    return args[0] === "rev-parse" ? `${base}\n` : args[0] === "diff" ? ":100644 100644 abc def M\0x.ts\0" : "";
  };
  const files = changedFilesAgainstFreshMain("/r", "h".repeat(40), base, run);
  assert.deepEqual(files, [regularFile("x.ts")]);
  const diff = calls.find((c) => c[0] === "diff");
  assert.ok(diff?.includes(`${base}...${"h".repeat(40)}`));
  assert.ok(!diff?.some((a) => a.includes("refs/remotes")));
});

test("a main mismatch refuses before any diff runs", () => {
  const calls: string[][] = [];
  const run = (args: string[]): string => {
    calls.push(args);
    return args[0] === "rev-parse" ? "a".repeat(40) : "";
  };
  assert.throws(() => changedFilesAgainstFreshMain("/r", "h".repeat(40), "b".repeat(40), run), /git fetch origin/);
  assert.ok(!calls.some((c) => c[0] === "diff"));
});
