import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeRevertRate, parseLog, readFirstParentLog } from "./revert-rate.ts";
import { fileURLToPath } from "node:url";
import { bin } from "./bin.ts";

export type PullRequest = {
  state: string;
  isDraft: boolean;
  headRefOid: string;
  baseRefName: string;
  reviewDecision: string | null;
  mergeable: string;
  files: { path: string }[];
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
};

export type ReviewResultFile = { status?: string; head?: string; base?: string; author?: string; reviewer?: string };
export type Family = "claude" | "codex";

export type GateOptions = {
  reviewResult: ReviewResultFile | null;
  author?: Family;
  unresolvedThreads: number;
  revertRate?: number | null;
  localHead?: string | null;
  currentBase?: string | null;
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
  [/^scripts\/(merge-gate|agent-|check-|revert-rate|deploy|render|assert-main|smoke)/, "merge, check or deploy tooling"],
  [/^tools\/(validator|repo-index)\//, "agent tooling"],
  [/^(\.oxlintrc\.json|package\.json|pnpm-workspace\.yaml|turbo\.json|AGENTS\.md|CLAUDE\.md|REVIEW\.md)$/, "repo rules or workspace config"],
  [/^apps\/web\/(eslint\.config\.js|eslint\.allowlists\.js)$/, "lint guardrail"],
  [/^\.claude\//, "agent skills"],
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
  if (pr.baseRefName !== "main") reasons.push(`PR targets ${pr.baseRefName}, not main; retarget it to main and re-run the gate, so the review covers the diff that will merge`);
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
    if (!review) reasons.push(`touches sensitive paths: ${list}. The trusted review did not complete; check the reviewer CLI and credentials, then re-run with --author claude|codex`);
    else if (!options.author || review.author !== options.author || !["claude", "codex"].includes(review.reviewer ?? "") || review.reviewer === review.author) reasons.push("review author or reviewer is invalid or matches; pass the correct --author and re-run the review with the other family");
    else if (review.status !== "clean") reasons.push(`the review result is "${review.status ?? "missing"}", not clean, and the PR touches sensitive paths: ${list}`);
    else if (review.head !== pr.headRefOid) reasons.push("the review result is for a different commit than the PR head; re-run the review");
    else if (!options.currentBase || review.base !== options.currentBase) reasons.push("the review result is for a different base commit than the current origin/main; re-run the gate");
  }
  return reasons;
}

function gh(args: string[]): string {
  return execFileSync(bin("gh"), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function git(args: string[], cwd: string): string {
  return execFileSync(bin("git"), args, { encoding: "utf8", cwd });
}

function changedFiles(number: string): { path: string }[] {
  const out = gh(["api", `repos/{owner}/{repo}/pulls/${number}/files`, "--paginate", "--jq", ".[].filename"]);
  return out.split("\n").filter(Boolean).map((path) => ({ path }));
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

export type PullRequestPin = { headRefOid: string; baseRefName: string };

export function baseStillCurrent(reviewBase: string, localMain: string, remoteMain: string): string[] {
  if (reviewBase && reviewBase === localMain && reviewBase === remoteMain) return [];
  return [`the reviewed base (${reviewBase.slice(0, 8) || "unknown"}) is not the current main: local origin/main is ${localMain.slice(0, 8) || "unknown"} and GitHub main is ${remoteMain.slice(0, 8) || "unknown"}; fetch main and re-run the gate`];
}

export type MainTips = { reviewBase: string; localMain: string; remoteMain: string };

export function finalMergeBlockers(before: PullRequestPin, now: PullRequestPin, tips: MainTips | null): string[] {
  return [...changedDuringReview(before, now), ...(tips ? baseStillCurrent(tips.reviewBase, tips.localMain, tips.remoteMain) : [])];
}

export function changedDuringReview(before: PullRequestPin, after: PullRequestPin): string[] {
  const reasons: string[] = [];
  if (after.headRefOid !== before.headRefOid) reasons.push("the PR head changed during review; check out the new head and re-run the gate");
  if (after.baseRefName !== before.baseRefName) reasons.push("the PR base changed during review; re-run the gate so the review covers the diff that will merge");
  return reasons;
}

export const REVIEW_BASE_REF = "refs/remotes/origin/main";

export function finalGateReasons(pr: Omit<PullRequest, "files">, options: Pick<GateOptions, "author" | "unresolvedThreads" | "localHead" | "worktreeClean">): string[] {
  return evaluateGate({ ...pr, files: [] }, { ...options, reviewResult: null });
}

export type FinalReader = {
  localHead: () => string;
  worktreeClean: () => boolean;
  localMain: () => string;
  unresolvedThreads: () => number;
  pullRequest: () => Omit<PullRequest, "files">;
  remoteMain: () => string;
};

export function finalPreMergeReasons(reader: FinalReader, before: PullRequestPin, author: Family, reviewBase: string | null): string[] {
  const localHead = reader.localHead();
  const worktreeClean = reader.worktreeClean();
  const localMain = reviewBase === null ? "" : reader.localMain();
  const unresolvedThreads = reader.unresolvedThreads();
  const refreshed = reader.pullRequest();
  const remoteMain = reviewBase === null ? "" : reader.remoteMain();
  return [
    ...finalGateReasons(refreshed, { author, unresolvedThreads, localHead, worktreeClean }),
    ...finalMergeBlockers(before, refreshed, reviewBase === null ? null : { reviewBase, localMain, remoteMain }),
  ];
}

export function runTrustedReview(script: string, root: string, author: Family, baseSha: string, runner: (file: string, args: string[], root: string) => string): ReviewResultFile | null {
  const ledgerDir = mkdtempSync(join(tmpdir(), "merge-gate-review-"));
  const asResult = (output: string): ReviewResultFile | null => {
    try {
      const value: unknown = JSON.parse(output);
      return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };
  try {
    return asResult(runner(process.execPath, [script, "--base", baseSha, "--author", author, "--json", "--no-index", "--strict", "--ledger", join(ledgerDir, "ledger.jsonl")], root));
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    return typeof stdout === "string" ? asResult(stdout) : null;
  } finally {
    rmSync(ledgerDir, { recursive: true, force: true });
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
  if (argv.includes("--review-result")) {
    console.error("--review-result is no longer accepted; pass --author claude|codex to run a trusted review");
    return 2;
  }
  const authorAt = argv.indexOf("--author");
  const author = argv[authorAt + 1];
  if (authorAt < 0 || (author !== "claude" && author !== "codex") || argv.lastIndexOf("--author") !== authorAt) {
    console.error("pass --author claude|codex exactly once to identify the author");
    return 2;
  }
  const verifyScript = process.env.MERGE_GATE_VERIFY_SCRIPT;
  if (!verifyScript) {
    console.error(
      "refusing to run: the gate must start from origin/main. Run `git fetch origin +refs/heads/main:refs/remotes/origin/main && git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh && git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- <pr> --author <claude|codex>`",
    );
    return 2;
  }
  const number = argv.find((a) => /^\d+$/.test(a));
  if (!number) {
    console.error("usage: node scripts/merge-gate.ts <pr-number> --author claude|codex [--dry-run]");
    return 2;
  }
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const root = process.env.MERGE_GATE_CHECKOUT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");

  const pr = JSON.parse(
    gh(["pr", "view", number, "--json", "state,isDraft,headRefOid,baseRefName,reviewDecision,mergeable,statusCheckRollup"]),
  ) as Omit<PullRequest, "files">;
  const revertRate = computeRevertRate(parseLog(readFirstParentLog(root)), Date.now(), 30).overall.rate;
  const files = changedFiles(number);
  const reviewResult = sensitivePaths(files.map((file) => file.path)).length > 0
    ? runTrustedReview(resolve(dirname(fileURLToPath(import.meta.url)), "agent-review.ts"), root, author, git(["rev-parse", REVIEW_BASE_REF], root).trim(), (file, args, cwd) => execFileSync(file, args, { encoding: "utf8", cwd, env: { ...process.env, MERGE_GATE_CHECKOUT_ROOT: root }, maxBuffer: 64 * 1024 * 1024 }))
    : null;
  const current = reviewResult ? (JSON.parse(gh(["pr", "view", number, "--json", "headRefOid,baseRefName"])) as PullRequestPin) : pr;
  const reasons = evaluateGate(
    { ...pr, files },
    {
      reviewResult,
      author,
      unresolvedThreads: unresolvedThreadCount(number),
      revertRate,
      localHead: git(["rev-parse", "HEAD"], root).trim(),
      currentBase: git(["rev-parse", REVIEW_BASE_REF], root).trim(),
      worktreeClean: git(["status", "--porcelain"], root).trim() === "",
    },
  );
  reasons.push(...changedDuringReview(pr, current));
  const mainTips = (): [string, string] => [git(["rev-parse", REVIEW_BASE_REF], root).trim(), gh(["api", "repos/{owner}/{repo}/branches/main", "--jq", ".commit.sha"]).trim()];
  if (reviewResult) reasons.push(...baseStillCurrent(reviewResult.base ?? "", ...mainTips()));
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
  const lastCheck = finalPreMergeReasons(
    {
      localHead: () => git(["rev-parse", "HEAD"], root).trim(),
      worktreeClean: () => git(["status", "--porcelain"], root).trim() === "",
      localMain: () => mainTips()[0],
      unresolvedThreads: () => unresolvedThreadCount(number),
      pullRequest: () => JSON.parse(gh(["pr", "view", number, "--json", "state,isDraft,headRefOid,baseRefName,reviewDecision,mergeable,statusCheckRollup"])) as Omit<PullRequest, "files">,
      remoteMain: () => mainTips()[1],
    },
    pr,
    author,
    reviewResult ? (reviewResult.base ?? "") : null,
  );
  if (lastCheck.length > 0) {
    console.error(`Not merging PR #${number}:`);
    for (const r of lastCheck) console.error(`  - ${r}`);
    return 1;
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
