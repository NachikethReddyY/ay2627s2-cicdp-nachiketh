import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bin } from "./bin.ts";

export type PullRequest = {
  state: string;
  isDraft: boolean;
  headRefOid: string;
  baseRefName: string;
  reviewDecision: string | null;
  mergeable: string;
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
};

export type GateOptions = {
  unresolvedThreads: number;
  localHead?: string | null;
  worktreeClean?: boolean;
};

export const REQUIRED_CHECKS = ["lint", "unit", "engine", "deploy-scripts", "e2e"];

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
  if (pr.baseRefName !== "main") reasons.push(`PR targets ${pr.baseRefName}, not main; retarget it to main and re-run the gate, so verification covers the diff that will merge`);
  if (pr.mergeable !== "MERGEABLE") reasons.push(`GitHub reports the PR as ${pr.mergeable.toLowerCase()}, not mergeable`);
  if (pr.reviewDecision === "CHANGES_REQUESTED") reasons.push("a reviewer requested changes");
  if (options.unresolvedThreads > 0) reasons.push(`${options.unresolvedThreads} unresolved review thread(s)`);

  for (const required of REQUIRED_CHECKS) {
    const matches = pr.statusCheckRollup.filter((c) => checkName(c) === required);
    if (matches.length === 0) reasons.push(`required check "${required}" has not reported on the head commit`);
    else if (!matches.every((c) => c.status === "COMPLETED" && checkOutcome(c) === "SUCCESS")) reasons.push(`required check "${required}" has not succeeded`);
  }
  if (options.localHead !== undefined && options.localHead !== pr.headRefOid) {
    reasons.push(`the checked-out commit (${(options.localHead ?? "unknown").slice(0, 8)}) is not the PR head (${pr.headRefOid.slice(0, 8)}); check out the PR head so verification covers it`);
  }
  if (options.worktreeClean === false) reasons.push("the working tree has uncommitted changes, so local verification would not match the PR");

  return reasons;
}

function gh(args: string[]): string {
  return execFileSync(bin("gh"), args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function git(args: string[], cwd: string): string {
  return execFileSync(bin("git"), args, { encoding: "utf8", cwd, maxBuffer: 256 * 1024 * 1024 });
}

type Snapshot = { pr: PullRequest; remoteMain: string; unresolvedThreads: number };
type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type ReviewThread = { isResolved: boolean };
type CheckPages = Record<string, Connection<Check>>;
type SnapshotPage = {
  main: { target: { oid: string } };
  pullRequest: Omit<PullRequest, "statusCheckRollup"> & Record<`threads${number}`, Connection<ReviewThread>> & {
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
  if (after.baseRefName !== before.baseRefName) reasons.push("the PR base changed during review; re-run the gate so verification covers the diff that will merge");
  return reasons;
}

export const REVIEW_BASE_REF = "refs/remotes/origin/main";

export function finalGateReasons(pr: PullRequest, options: GateOptions): string[] {
  return evaluateGate(pr, options);
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

const GITHUB_TOKEN_VARS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];

export function verifyEnv(env: NodeJS.ProcessEnv, root: string, ghConfigDir: string): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !GITHUB_TOKEN_VARS.includes(key)));
  return { ...kept, GH_CONFIG_DIR: ghConfigDir, MERGE_GATE_CHECKOUT_ROOT: root };
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("--skip-local")) {
    console.error("--skip-local is no longer supported; remove it and run local verification");
    return 2;
  }
  if (argv.includes("--review-result")) {
    console.error("--review-result is no longer accepted; run the review separately");
    return 2;
  }
  const verifyScript = process.env.MERGE_GATE_VERIFY_SCRIPT;
  const bootstrapBase = process.env.MERGE_GATE_BASE_SHA;
  if (!verifyScript || !bootstrapBase || !/^[0-9a-f]{40}$/.test(bootstrapBase)) {
    console.error(
      "refusing to run: the gate must start from origin/main. Run `git fetch origin +refs/heads/main:refs/remotes/origin/main && git cat-file -e refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh && git show refs/remotes/origin/main:scripts/merge-gate-bootstrap.sh | bash -s -- <pr>`",
    );
    return 2;
  }
  const number = argv.find((a) => /^\d+$/.test(a));
  if (!number) {
    console.error("usage: node scripts/merge-gate.ts <pr-number> [--dry-run]");
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
  reasons.push(...evaluateGate(pr, { unresolvedThreads, localHead, worktreeClean }));
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main(process.argv.slice(2)).then((code) => process.exit(code));
