import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { computeRevertRate, parseLog, readFirstParentLog } from "./revert-rate.ts";
import { fileURLToPath } from "node:url";
import { bin } from "./bin.ts";

type ChangedFile = { path: string; oldMode: string; newMode: string };

export type PullRequest = {
  state: string;
  isDraft: boolean;
  headRefOid: string;
  baseRefName: string;
  reviewDecision: string | null;
  mergeable: string;
  files: ChangedFile[];
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
};

export type ReviewResultFile = { status?: string; head?: string; base?: string; author?: string; reviewer?: string; reason?: string };
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

const ORDINARY_DOCUMENTS = new Set([
  "README.md",
  "docs/plan.md",
  "docs/feature-map.md",
  "docs/adr/0001-object-storage.md",
  "docs/adr/0002-visual-trust-model.md",
  "docs/adr/0003-engine-boundary.md",
  "docs/adr/0004-coverage-gate.md",
]);

export function sensitivePaths(files: ChangedFile[]): ChangedFile[] {
  return files.filter(({ path, oldMode, newMode }) => {
    const regularDocument = (oldMode === "100644" && newMode === "100644")
      || (oldMode === "000000" && newMode === "100644")
      || (oldMode === "100644" && newMode === "000000");
    return !(regularDocument && ORDINARY_DOCUMENTS.has(path));
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

  const sensitive = sensitivePaths(pr.files);
  if (sensitive.length > 0) {
    const review = options.reviewResult;
    const list = sensitive.slice(0, 5).map((s) => JSON.stringify(s.path)).join(", ");
    if (!review) reasons.push(`touches sensitive paths: ${list}. The trusted review did not complete. Check the reviewer CLI and the review process limits`);
    else if (!options.author || review.author !== options.author || !["claude", "codex"].includes(review.reviewer ?? "") || review.reviewer === review.author) reasons.push("trusted review metadata is inconsistent with the declared author or required reviewer family");
    else if (review.status === "incomplete" && options.author === "claude" && review.reason?.includes("strict review is unavailable for Codex")) reasons.push("strict Codex review is unavailable because its CLI cannot disable all model tools; the review is incomplete");
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
  return execFileSync(bin("git"), args, { encoding: "utf8", cwd, maxBuffer: 256 * 1024 * 1024 });
}

const BASE_REF = "refs/remotes/origin/main";

export function parseRawDiffZ(out: string): ChangedFile[] {
  const fields = out.split("\0");
  if (fields.pop() !== "") throw new Error("incomplete raw Git diff");
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; ) {
    const header = /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]+ [0-9a-f]+ (R\d+|C\d+|[ADMT])$/.exec(fields[i++]);
    if (!header) throw new Error("unrecognized raw Git diff record");
    const [, oldMode, newMode, status] = header;
    const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
    for (let n = 0; n < pathCount; n++) {
      const path = fields[i++];
      if (!path) throw new Error("missing path in raw Git diff");
      files.push({ path, oldMode, newMode });
    }
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

export function changedFilesFromGit(root: string, headRefOid: string, base: string = BASE_REF, run: GitRunner = git): ChangedFile[] {
  try {
    run(["cat-file", "-e", `${headRefOid}^{commit}`], root);
  } catch {
    throw new Error(`the PR head ${headRefOid.slice(0, 8)} is not in the local repository; run \`git fetch origin\` and check out the PR head`);
  }
  return parseRawDiffZ(run(["diff", "--raw", "-z", "-M", "--find-copies-harder", "--ignore-submodules=none", `${base}...${headRefOid}`], root));
}

export function changedFilesAgainstFreshMain(root: string, headRefOid: string, remoteMainSha: string, run: GitRunner = git): ChangedFile[] {
  const base = run(["rev-parse", BASE_REF], root).trim();
  assertBaseIsCurrent(base, remoteMainSha);
  return changedFilesFromGit(root, headRefOid, base, run);
}

export function changedFiles(root: string, base: string, head: string): ChangedFile[] {
  return changedFilesFromGit(root, head, base);
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

export async function runTrustedReview(script: string, root: string, author: Family, baseSha: string, runner: (file: string, args: string[], root: string) => string | Promise<string>): Promise<ReviewResultFile | null> {
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
    return asResult(await runner(process.execPath, [script, "--base", baseSha, "--author", author, "--json", "--no-index", "--strict", "--ledger", join(ledgerDir, "ledger.jsonl")], root));
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    const result = typeof stdout === "string" ? asResult(stdout) : null;
    return result?.status === "findings" || result?.status === "incomplete" ? result : null;
  } finally {
    rmSync(ledgerDir, { recursive: true, force: true });
  }
}

export function trustedReviewProcess(file: string, args: string[], root: string, timeoutMs = 42 * 60 * 1000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, { cwd: root, env: { ...process.env, MERGE_GATE_CHECKOUT_ROOT: root, MERGE_GATE_REVIEW_PROCESS_GROUP: "1" }, stdio: ["ignore", "pipe", "ignore"], detached: true });
    let output = "";
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const stop = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      stop();
      finish(() => reject(new Error("trusted review timed out")));
    }, timeoutMs);
    let bytes = 0;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > 64 * 1024 * 1024) {
        stop();
        finish(() => reject(new Error("trusted review output exceeded the limit")));
        return;
      }
      output += chunk;
    });
    child.once("exit", stop);
    child.on("error", () => finish(() => reject(new Error("trusted review failed to start"))));
    child.on("close", (code) => finish(() => {
      if (code === 0) resolvePromise(output);
      else reject(Object.assign(new Error("trusted review failed"), { stdout: output }));
    }));
  });
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
    if (sensitivePaths(files).length > 0) {
      const script = resolve(dirname(fileURLToPath(import.meta.url)), "agent-review.ts");
      const reviewResult = await runTrustedReview(script, root, author, bootstrapBase, trustedReviewProcess);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main(process.argv.slice(2)).then((code) => process.exit(code));
