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

export function changedFiles(root: string, base: string, head: string): { path: string }[] {
  const out = git(["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none", `${base}...${head}`, "--"], root);
  return out.split("\0").filter(Boolean).map((path) => ({ path }));
}

type Snapshot = { pr: Omit<PullRequest, "files">; remoteMain: string; unresolvedThreads: number };
type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type ReviewThread = { isResolved: boolean };
type CheckPages = Record<string, Connection<Check>>;
type SnapshotPage = {
  main: { target: { oid: string } };
  pullRequest: Omit<PullRequest, "files" | "statusCheckRollup"> & Record<`threads${number}`, Connection<ReviewThread>> & {
    commits: { nodes: { commit: { oid: string; statusCheckRollup: CheckPages | null } }[] };
  };
};

function pageFields(alias: string, field: string, cursors: string[], nodeFields: string): string {
  return [null, ...cursors].map((cursor, i) => {
    const after = cursor === null ? "" : `,after:${JSON.stringify(cursor)}`;
    return `${alias}${i}:${field}(first:100${after}) { pageInfo { hasNextPage endCursor } nodes { ${nodeFields} } }`;
  }).join("\n");
}

function readPages<T>(cursors: string[], pageAt: (i: number) => Connection<T> | undefined): { nodes: T[]; next: string | null } {
  const nodes: T[] = [];
  let next: string | null = null;
  for (let i = 0; i <= cursors.length; i++) {
    const page = pageAt(i);
    if (!page || typeof page.pageInfo?.hasNextPage !== "boolean") throw new Error("GitHub returned an incomplete page of checks or review threads; re-run the gate");
    next = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if ((page.pageInfo.hasNextPage && !next) || (i < cursors.length && next !== cursors[i])) {
      throw new Error("GitHub pagination changed while reading checks and review threads; re-run the gate");
    }
    nodes.push(...page.nodes);
  }
  if (next && cursors.includes(next)) throw new Error("GitHub returned a repeated cursor; re-run the gate");
  return { nodes, next };
}

export function readSnapshot(number: string, request = gh): Snapshot {
  const threadCursors: string[] = [];
  const checkCursors: string[] = [];
  for (;;) {
    const threadFields = pageFields("threads", "reviewThreads", threadCursors, "isResolved");
    const checkFields = pageFields("checks", "contexts", checkCursors, "... on CheckRun { name status conclusion } ... on StatusContext { context state }");
    const query = `query($owner:String!,$repo:String!,$n:Int!) {
      repository(owner:$owner,name:$repo) {
        main:ref(qualifiedName:"refs/heads/main") { target { oid } }
        pullRequest(number:$n) {
          state isDraft headRefOid baseRefName reviewDecision mergeable
          ${threadFields}
          commits(last:1) { nodes { commit { oid statusCheckRollup { ${checkFields} } } } }
        }
      }
    }`;
    const args = ["api", "graphql", "-f", `query=${query}`, "-F", "owner={owner}", "-F", "repo={repo}", "-F", `n=${number}`];
    const response = JSON.parse(request(args)) as { data: { repository: SnapshotPage }; errors?: unknown[] };
    if (response.errors?.length) throw new Error("GitHub returned an incomplete PR snapshot; re-run the gate");
    const { main, pullRequest } = response.data.repository;
    const commit = pullRequest.commits.nodes[0]?.commit;
    if (!commit || commit.oid !== pullRequest.headRefOid) throw new Error("the PR head and checks refer to different commits; re-run the gate");
    const threads = readPages(threadCursors, (i) => pullRequest[`threads${i}`]);
    const rollup = commit.statusCheckRollup;
    const checks = rollup ? readPages(checkCursors, (i) => rollup[`checks${i}`]) : { nodes: [], next: null };
    if (!threads.next && !checks.next) {
      return {
        pr: { ...pullRequest, statusCheckRollup: checks.nodes },
        remoteMain: main.target.oid,
        unresolvedThreads: threads.nodes.filter((thread) => thread.isResolved !== true).length,
      };
    }
    if (threads.next) threadCursors.push(threads.next);
    if (checks.next) checkCursors.push(checks.next);
  }
}

export type PullRequestPin = { headRefOid: string; baseRefName: string };

export function baseStillCurrent(reviewBase: string, localMain: string, remoteMain: string): string[] {
  if (reviewBase && reviewBase === localMain && reviewBase === remoteMain) return [];
  return [`the bootstrap base (${reviewBase.slice(0, 8) || "unknown"}) is not the current main: local origin/main is ${localMain.slice(0, 8) || "unknown"} and GitHub main is ${remoteMain.slice(0, 8) || "unknown"}; fetch main and re-run the gate`];
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
  snapshot: () => Snapshot;
};

export function finalPreMergeReasons(reader: FinalReader, before: PullRequestPin, bootstrapBase: string): string[] {
  const localHead = reader.localHead();
  const worktreeClean = reader.worktreeClean();
  const localMain = reader.localMain();
  const { pr, remoteMain, unresolvedThreads } = reader.snapshot();
  return [
    ...finalGateReasons(pr, { unresolvedThreads, localHead, worktreeClean }),
    ...changedDuringReview(before, pr),
    ...baseStillCurrent(bootstrapBase, localMain, remoteMain),
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
  const bootstrapBase = process.env.MERGE_GATE_BASE_SHA;
  if (!verifyScript || !bootstrapBase || !/^[0-9a-f]{40}$/.test(bootstrapBase)) {
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

  const reader: FinalReader = {
    localHead: () => git(["rev-parse", "HEAD"], root).trim(),
    worktreeClean: () => git(["status", "--porcelain"], root).trim() === "",
    localMain: () => git(["rev-parse", REVIEW_BASE_REF], root).trim(),
    snapshot: () => readSnapshot(number),
  };
  const { pr, remoteMain, unresolvedThreads } = reader.snapshot();
  const reasons = baseStillCurrent(bootstrapBase, reader.localMain(), remoteMain);
  const localHead = reader.localHead();
  const worktreeClean = reader.worktreeClean();
  const revertRate = computeRevertRate(parseLog(readFirstParentLog(root, bootstrapBase)), Date.now(), 30).overall.rate;
  reasons.push(...evaluateGate({ ...pr, files: [] }, { reviewResult: null, unresolvedThreads, localHead, worktreeClean, revertRate }));
  if (reasons.length === 0) {
    const files = changedFiles(root, bootstrapBase, pr.headRefOid);
    if (sensitivePaths(files.map((file) => file.path)).length > 0) {
      const script = resolve(dirname(fileURLToPath(import.meta.url)), "agent-review.ts");
      const reviewResult = runTrustedReview(script, root, author, bootstrapBase, (file, args, cwd) =>
        execFileSync(file, args, { encoding: "utf8", cwd, env: { ...process.env, MERGE_GATE_CHECKOUT_ROOT: root }, maxBuffer: 64 * 1024 * 1024 }));
      reasons.push(...evaluateGate({ ...pr, files }, { reviewResult, author, unresolvedThreads, currentBase: bootstrapBase }));
      if (reasons.length === 0) reasons.push(...finalPreMergeReasons(reader, pr, bootstrapBase));
    }
  }
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
  const lastCheck = finalPreMergeReasons(reader, pr, bootstrapBase);
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
