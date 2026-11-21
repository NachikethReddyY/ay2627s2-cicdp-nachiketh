import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeRevertRate, parseLog, readFirstParentLog } from "./revert-rate.ts";
import { fileURLToPath } from "node:url";
import { bin } from "./bin.ts";

export type PullRequest = {
  state: string;
  isDraft: boolean;
  headRefOid: string;
  reviewDecision: string | null;
  mergeable: string;
  files: { path: string }[];
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
};

export type ReviewResultFile = { status?: string; head?: string };

export type GateOptions = {
  reviewResult: ReviewResultFile | null;
  unresolvedThreads: number;
  revertRate?: number | null;
  localHead?: string | null;
  worktreeClean?: boolean;
};

export const REVERT_RATE_LIMIT = 0.05;
export const REQUIRED_CHECKS = ["lint", "unit", "engine", "deploy-scripts", "e2e"];

const SENSITIVE: [RegExp, string][] = [
  [/^apps\/api\/src\/auth\//, "auth"],
  [/^apps\/api\/src\/trpc\//, "auth guards"],
  [/^apps\/api\/src\/(access|env)\.ts$/, "access control or secrets config"],
  [/^apps\/api\/src\/config\//, "config and limits"],
  [/^apps\/api\/src\/(sandbox|parts|grading|safety)\//, "practice run or answer handling"],
  [/^apps\/api\/src\/(attempts|lessons)\/router\.ts$/, "answer and hint exposure"],
  [/^apps\/api\/src\/(games\/grade|attempts\/machine|dev\/route)\.ts$/, "grading or help guardrails"],
  [/^apps\/api\/src\/progress\/mastery\.ts$/, "learner model"],
  [/^apps\/api\/src\/app\.ts$/, "API configuration"],
  [/^apps\/api\/src\/imports\/routes\.ts$/, "import access guards"],
  [/^apps\/api\/src\/(progress|lint|ai|engine-client|db|imports|media)\//, "learner scoping, authorization, answer exposure or engine credentials"],
  [/^packages\/ui-catalog\/src\/blocks\/game\/public\.ts$/, "answer stripping for games"],
  [/^INSTRUCTIONS\.md$/, "Sloppy system prompt"],
  [/^\.(agents|claude)\//, "agent skills and settings"],
  [/^apps\/api\/test\//, "API tests and test helpers"],
  [/^apps\/api\/drizzle\//, "database migration"],
  [/^apps\/api\/drizzle\.config\.ts$/, "database migration"],
  [/^\.github\//, "workflow or repo policy"],
  [/^infra\//, "infra"],
  [/^docker-compose.*\.yml$/, "infra"],
  [/(^|\/)([^/]*\.)?Dockerfile$/, "infra"],
  [/(^|\/)vercel\.json$/, "deploy config"],
  [/^services\/sandbox\//, "sandbox boundary"],
  [/^services\/engine\/learnquest_engine\/prompts\//, "engine prompt"],
  [/^services\/engine\/(pyproject\.toml|scripts\/check_comments\.py)$/, "engine guardrail config"],
  [/^scripts\//, "repo tooling"],
  [/^packages\/ui-catalog\/src\/index\.ts$/, "public catalogue entry point"],
  [/^apps\/web\/src\/player\//, "client reveal timing"],
  [/^docs\/agents\//, "agent guides"],
  [/^apps\/web\/scripts\//, "runs during the web build"],
  [/^\.pnpmfile\.(mjs|cjs)$/, "install hooks"],
  [/^apps\/web\/src\/lib\//, "browser auth and learner passwords"],
  [/^apps\/web\/src\/pages\/Login\.tsx$/, "browser auth and learner passwords"],
  [/^worlds\//, "seed prompts and answer keys"],
  [/^spikes\//, "run by the required engine check"],
  [/^apps\/web\/src\/blocks\/game\//, "game hint request and timing"],
  [/(^|\/)(Dockerfile[\w.-]*|\.dockerignore|docker-compose[\w.-]*\.yml|uv\.lock|vite\.config\.ts|neon\.ts)$/, "build inputs and deploy config"],
  [/(^|\/)package\.json$/, "package configuration"],
  [/^pnpm-lock\.yaml$/, "dependency lockfile"],
  [/^tools\/(validator|repo-index)\//, "agent tooling"],
  [/^(\.oxlintrc\.json|pnpm-workspace\.yaml|turbo\.json|AGENTS\.md|CLAUDE\.md|REVIEW\.md)$/, "repo rules or workspace config"],
  [/^apps\/web\/(eslint\.config\.js|eslint\.allowlists\.js)$/, "lint guardrail"],
  [/^apps\/web\/(index\.html|src\/main\.tsx)$/, "web entry point"],
  [/(^|\/)([^/]*\.config\.[cm]?[jt]s|[^/]*\.config\.json|tsconfig[^/]*\.json)$/, "tool config executed from parent directories"],
  [/(^|\/)(\.eslintignore|\.prettierignore|\.oxlintrc[\w.]*)$/, "lint and format config"],
  [/(^|\/)middleware\.[cm]?[jt]s$/, "routing middleware"],
  [/^(apps\/web\/)?api\//, "serverless handlers"],
  [/(^|\/)(AGENTS|CLAUDE)\.md$/, "agent instructions"],
  [/(^|\/)\.(cursor|github)\//, "agent or repo policy"],
  [/^\.gitmodules$/, "submodule sources"],
  [/(^|\/)\.env[\w.-]*$/, "environment files"],
  [/(^|\/)\.babelrc[\w.]*$/, "tool config run at startup"],
  [/(^|\/)\.[\w-]+rc(\.[cm]?[jt]s|\.json|\.ya?ml)?$/, "tool config run at startup"],
  [/(^|\/)(\.npmrc|\.nvmrc|\.node-version|\.tool-versions)$/, "toolchain config"],
  [/(^|\/)\.husky\//, "git hooks"],
  [/^\.macroscope\//, "review policy"],
];

const NOT_SENSITIVE: RegExp[] = [
  /^apps\/web\//,
  /^docs\//,
  /(^|\/)README\.md$/,
  /^(?!apps\/api\/|services\/engine\/)(.*\/)?(fixtures|__fixtures__|__snapshots__)\/.*\.(json|txt|md|csv|snap|png|jpg|svg|ya?ml)$/,
];

const DENY_BY_DEFAULT: [RegExp, string][] = [
  [/^apps\/api\/src\//, "API source: authorization, answers, learner scoping"],
  [/^services\/engine\//, "engine: learner model, answers, credentials"],
  [/^packages\//, "shared packages: replay, answer stripping, catalogue"],
  [/^e2e\//, "required e2e check"],
];

export function sensitivePaths(paths: string[]): { path: string; why: string }[] {
  return paths.flatMap((path) => {
    const exact = SENSITIVE.find(([re]) => re.test(path));
    if (exact) return [{ path, why: exact[1] }];
    if (NOT_SENSITIVE.some((re) => re.test(path))) return [];
    const denied = DENY_BY_DEFAULT.find(([re]) => re.test(path));
    return denied ? [{ path, why: denied[1] }] : [];
  });
}

type Check = PullRequest["statusCheckRollup"][number];

function checkName(check: Check): string {
  return check.name ?? check.context ?? "unnamed check";
}

function checkOutcome(check: Check): string {
  return check.conclusion ?? check.state ?? "";
}

export function evaluateGate(pr: PullRequest, options: GateOptions): string[] {
  const reasons: string[] = [];
  if (pr.state !== "OPEN") reasons.push(`PR is ${pr.state}, not OPEN`);
  if (pr.isDraft) reasons.push("PR is a draft");
  if (pr.mergeable !== "MERGEABLE") reasons.push(`GitHub reports the PR as ${pr.mergeable.toLowerCase()}, not mergeable`);
  if (pr.reviewDecision === "CHANGES_REQUESTED") reasons.push("a reviewer requested changes");
  if (options.unresolvedThreads > 0) reasons.push(`${options.unresolvedThreads} unresolved review thread(s)`);

  for (const required of REQUIRED_CHECKS) {
    const matches = pr.statusCheckRollup.filter((c) => checkName(c) === required);
    if (matches.length === 0) reasons.push(`required check "${required}" has not reported on the head commit`);
    else if (!matches.every((c) => c.status === "COMPLETED" && checkOutcome(c) === "SUCCESS")) reasons.push(`required check "${required}" has not succeeded`);
  }
  for (const check of pr.statusCheckRollup) {
    const outcome = checkOutcome(check);
    if (check.status && check.status !== "COMPLETED") reasons.push(`check "${checkName(check)}" is still ${check.status.toLowerCase()}`);
    else if (!["SUCCESS", "NEUTRAL", "SKIPPED"].includes(outcome)) reasons.push(`check "${checkName(check)}" is ${outcome.toLowerCase() || "not passing"}`);
  }

  if (options.localHead !== undefined && options.localHead !== pr.headRefOid) {
    reasons.push(`the checked-out commit (${(options.localHead ?? "unknown").slice(0, 8)}) is not the PR head (${pr.headRefOid.slice(0, 8)}); check out the PR head so verification covers it`);
  }
  if (options.worktreeClean === false) reasons.push("the working tree has uncommitted changes, so local verification would not match the PR");

  if (options.revertRate !== undefined && options.revertRate !== null && options.revertRate > REVERT_RATE_LIMIT) {
    const pct = (options.revertRate * 100).toFixed(1);
    reasons.push(`revert rate is ${pct}% over the last 30 days, above ${REVERT_RATE_LIMIT * 100}%. Agents stop self-merging until it falls; a human merges`);
  }

  const sensitive = sensitivePaths(pr.files.map((f) => f.path));
  if (sensitive.length > 0) {
    const review = options.reviewResult;
    const list = sensitive.slice(0, 5).map((s) => `${s.path} (${s.why})`).join(", ");
    if (!review) reasons.push(`touches sensitive paths: ${list}. Pass --review-result <file> from \`agent-review --json\` on this head commit`);
    else if (review.status !== "clean") reasons.push(`the review result is "${review.status ?? "missing"}", not clean, and the PR touches sensitive paths: ${list}`);
    else if (review.head !== pr.headRefOid) reasons.push("the review result is for a different commit than the PR head; re-run the review");
  }
  return reasons;
}

function gh(args: string[]): string {
  return execFileSync(bin("gh"), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function git(args: string[], cwd: string): string {
  return execFileSync(bin("git"), args, { encoding: "utf8", cwd, maxBuffer: 256 * 1024 * 1024 });
}

const BASE_REF = "refs/remotes/origin/main";

export function parseNameStatusZ(out: string): { path: string }[] {
  const fields = out.split("\0");
  const files: { path: string }[] = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i];
    if (!status) break;
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (const path of fields.slice(i + 1, i + 1 + pathCount)) files.push({ path });
    i += 1 + pathCount;
  }
  return files;
}

export function assertBaseIsCurrent(localSha: string, remoteSha: string): void {
  const fix = "run `git fetch origin +refs/heads/main:refs/remotes/origin/main` and re-run the gate";
  if (!localSha.trim() || !remoteSha.trim()) throw new Error(`could not read both the local and GitHub main commits; ${fix}`);
  if (localSha.trim() !== remoteSha.trim()) {
    throw new Error(`local origin/main (${localSha.trim().slice(0, 8)}) is not GitHub main (${remoteSha.trim().slice(0, 8)}), so the diff could hide a revert; ${fix}`);
  }
}

type GitRunner = (args: string[], cwd: string) => string;

export function changedFilesFromGit(root: string, headRefOid: string, base: string = BASE_REF, run: GitRunner = git): { path: string }[] {
  try {
    run(["cat-file", "-e", `${headRefOid}^{commit}`], root);
  } catch {
    throw new Error(`the PR head ${headRefOid.slice(0, 8)} is not in the local repository; run \`git fetch origin\` and check out the PR head`);
  }
  return parseNameStatusZ(run(["diff", "--name-status", "-z", "-M", "--ignore-submodules=none", `${base}...${headRefOid}`], root));
}

export function changedFilesAgainstFreshMain(root: string, headRefOid: string, remoteMainSha: string, run: GitRunner = git): { path: string }[] {
  const base = run(["rev-parse", BASE_REF], root).trim();
  assertBaseIsCurrent(base, remoteMainSha);
  return changedFilesFromGit(root, headRefOid, base, run);
}

function unresolvedThreadCount(number: string): number {
  const query = `query($owner:String!,$repo:String!,$n:Int!,$after:String){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{isResolved}}}}}`;
  const repo = JSON.parse(gh(["repo", "view", "--json", "owner,name"])) as { owner: { login: string }; name: string };
  type Page = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { isResolved: boolean }[] } } } } };
  let unresolved = 0;
  let after: string | null = null;
  for (;;) {
    const args = ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${repo.owner.login}`, "-F", `repo=${repo.name}`, "-F", `n=${number}`];
    if (after) args.push("-F", `after=${after}`);
    const page = JSON.parse(gh(args)) as Page;
    const threads = page.data.repository.pullRequest.reviewThreads;
    unresolved += threads.nodes.filter((t) => !t.isResolved).length;
    if (!threads.pageInfo.hasNextPage) return unresolved;
    after = threads.pageInfo.endCursor;
  }
}

function readReviewResult(path: string | undefined): ReviewResultFile | null {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ReviewResultFile;
  } catch {
    return { status: "unreadable" };
  }
}

const GITHUB_TOKEN_VARS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];

export function verifyEnv(env: NodeJS.ProcessEnv, root: string, ghConfigDir: string): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !GITHUB_TOKEN_VARS.includes(key)));
  return { ...kept, GH_CONFIG_DIR: ghConfigDir, MERGE_GATE_CHECKOUT_ROOT: root };
}

function main(argv: string[]): number {
  if (argv.includes("--skip-local")) {
    console.error("--skip-local is no longer supported; remove it and run local verification");
    return 2;
  }
  const verifyScript = process.env.MERGE_GATE_VERIFY_SCRIPT;
  if (!verifyScript) {
    console.error(
      "refusing to run: the gate must start from origin/main. Run `git fetch origin +refs/heads/main:refs/remotes/origin/main && git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh && git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- <pr>`",
    );
    return 2;
  }
  const number = argv.find((a) => /^\d+$/.test(a));
  if (!number) {
    console.error("usage: node scripts/merge-gate.ts <pr-number> [--review-result <file>] [--dry-run]");
    return 2;
  }
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const reviewFlagAt = argv.indexOf("--review-result");
  const reviewResult = readReviewResult(reviewFlagAt >= 0 ? argv[reviewFlagAt + 1] : undefined);
  const root = process.env.MERGE_GATE_CHECKOUT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");

  const pr = JSON.parse(
    gh(["pr", "view", number, "--json", "state,isDraft,headRefOid,reviewDecision,mergeable,statusCheckRollup"]),
  ) as Omit<PullRequest, "files">;
  const remoteMainSha = gh(["api", "repos/{owner}/{repo}/branches/main", "--jq", ".commit.sha"]);
  const changed = changedFilesAgainstFreshMain(root, pr.headRefOid, remoteMainSha);
  const revertRate = computeRevertRate(parseLog(readFirstParentLog(root)), Date.now(), 30).overall.rate;
  const reasons = evaluateGate(
    { ...pr, files: changed },
    {
      reviewResult,
      unresolvedThreads: unresolvedThreadCount(number),
      revertRate,
      localHead: git(["rev-parse", "HEAD"], root).trim(),
      worktreeClean: git(["status", "--porcelain"], root).trim() === "",
    },
  );
  if (reasons.length > 0) {
    console.error(`Not merging PR #${number}:`);
    for (const r of reasons) console.error(`  - ${r}`);
    return 1;
  }

  const ghConfigDir = mkdtempSync(join(tmpdir(), "merge-gate-gh-"));
  try {
    execFileSync(verifyScript, { stdio: "inherit", cwd: root, env: verifyEnv(process.env, root, ghConfigDir) });
  } finally {
    rmSync(ghConfigDir, { recursive: true, force: true });
  }
  if (flags.has("--dry-run")) {
    console.log(`PR #${number} passes every gate. Dry run, not merging.`);
    return 0;
  }
  gh(["pr", "merge", number, "--squash", "--delete-branch", "--match-head-commit", pr.headRefOid]);
  console.log(`Merged PR #${number} at ${pr.headRefOid}. Main deploys after CI.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
