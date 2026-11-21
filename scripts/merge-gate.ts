import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  [/^apps\/api\/src\/progress\/games\.ts$/, "game hint router"],
  [/^packages\/ui-catalog\/src\/blocks\/game\/public\.ts$/, "answer stripping for games"],
  [/^services\/engine\/learnquest_engine\/server\.py$/, "engine token guard"],
  [/^INSTRUCTIONS\.md$/, "Sloppy system prompt"],
  [/^\.(agents|claude)\//, "agent skills and settings"],
  [/^apps\/api\/test\/helpers/, "API test helpers"],
  [/^apps\/api\/drizzle\//, "database migration"],
  [/^apps\/api\/drizzle\.config\.ts$/, "database migration"],
  [/^\.github\//, "workflow or repo policy"],
  [/^infra\//, "infra"],
  [/^docker-compose.*\.yml$/, "infra"],
  [/(^|\/)([^/]*\.)?Dockerfile$/, "infra"],
  [/(^|\/)vercel\.json$/, "deploy config"],
  [/^services\/sandbox\//, "sandbox boundary"],
  [/^services\/engine\/learnquest_engine\/prompts\//, "engine prompt"],
  [/^services\/engine\/learnquest_engine\/(guide|bkt|policy|learner)\.py$/, "help or learner model"],
  [/^services\/engine\/(pyproject\.toml|scripts\/check_comments\.py)$/, "engine guardrail config"],
  [/^scripts\//, "repo tooling"],
  [/^e2e\/scripts\/ci\.sh$/, "CI tooling"],
  [/(^|\/)package\.json$/, "package configuration"],
  [/^pnpm-lock\.yaml$/, "dependency lockfile"],
  [/^tools\/(validator|repo-index)\//, "agent tooling"],
  [/^(\.oxlintrc\.json|pnpm-workspace\.yaml|turbo\.json|AGENTS\.md|CLAUDE\.md|REVIEW\.md)$/, "repo rules or workspace config"],
  [/^apps\/web\/(eslint\.config\.js|eslint\.allowlists\.js)$/, "lint guardrail"],
];

export function sensitivePaths(paths: string[]): { path: string; why: string }[] {
  return paths.flatMap((path) => {
    const hit = SENSITIVE.find(([re]) => re.test(path));
    return hit ? [{ path, why: hit[1] }] : [];
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
  return execFileSync(bin("git"), args, { encoding: "utf8", cwd });
}

const GITHUB_FILE_LIST_CAP = 3000;

export function parseChangedFiles(tsv: string): { path: string }[] {
  const rows = tsv.split("\n").filter(Boolean);
  if (rows.length >= GITHUB_FILE_LIST_CAP) {
    throw new Error(
      `GitHub lists at most ${GITHUB_FILE_LIST_CAP} changed files, so this PR may be truncated; split it into smaller PRs`,
    );
  }
  const paths = rows.flatMap((row) => row.split("\t").filter(Boolean));
  return paths.map((path) => ({ path }));
}

export const CHANGED_FILES_JQ = '.[] | [.filename, (.previous_filename // "")] | @tsv';

function changedFiles(number: string): { path: string }[] {
  const out = gh(["api", `repos/{owner}/{repo}/pulls/${number}/files`, "--paginate", "--jq", CHANGED_FILES_JQ]);
  return parseChangedFiles(out);
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

function main(argv: string[]): number {
  const number = argv.find((a) => /^\d+$/.test(a));
  if (!number) {
    console.error("usage: node scripts/merge-gate.ts <pr-number> [--review-result <file>] [--dry-run] [--skip-local]");
    return 2;
  }
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const reviewFlagAt = argv.indexOf("--review-result");
  const reviewResult = readReviewResult(reviewFlagAt >= 0 ? argv[reviewFlagAt + 1] : undefined);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  const pr = JSON.parse(
    gh(["pr", "view", number, "--json", "state,isDraft,headRefOid,reviewDecision,mergeable,statusCheckRollup"]),
  ) as Omit<PullRequest, "files">;
  const revertRate = computeRevertRate(parseLog(readFirstParentLog(root)), Date.now(), 30).overall.rate;
  const skipLocal = flags.has("--skip-local");
  const reasons = evaluateGate(
    { ...pr, files: changedFiles(number) },
    {
      reviewResult,
      unresolvedThreads: unresolvedThreadCount(number),
      revertRate,
      localHead: skipLocal ? undefined : git(["rev-parse", "HEAD"], root).trim(),
      worktreeClean: skipLocal ? undefined : git(["status", "--porcelain"], root).trim() === "",
    },
  );
  if (reasons.length > 0) {
    console.error(`Not merging PR #${number}:`);
    for (const r of reasons) console.error(`  - ${r}`);
    return 1;
  }

  if (!skipLocal) {
    execFileSync(resolve(root, "scripts/agent-verify.sh"), { stdio: "inherit", cwd: root });
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
