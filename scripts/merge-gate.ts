import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { computeRevertRate, parseLog, readFirstParentLog } from "./revert-rate.ts";
import { fileURLToPath } from "node:url";

export type PullRequest = {
  state: string;
  isDraft: boolean;
  headRefOid: string;
  reviewDecision: string | null;
  mergeable: string;
  files: { path: string }[];
  statusCheckRollup: { name?: string; context?: string; status?: string; conclusion?: string; state?: string }[];
};

export type GateOptions = { sensitive: boolean; unresolvedThreads: number; revertRate?: number | null };

export const REVERT_RATE_LIMIT = 0.05;

const SENSITIVE: [RegExp, string][] = [
  [/^apps\/api\/src\/auth\//, "auth"],
  [/^apps\/api\/drizzle\//, "database migration"],
  [/^apps\/api\/drizzle\.config\.ts$/, "database migration"],
  [/^\.github\/workflows\//, "workflow"],
  [/^infra\//, "infra"],
  [/^docker-compose.*\.yml$/, "infra"],
  [/(^|\/)Dockerfile|\.Dockerfile$/, "infra"],
  [/^services\/sandbox\//, "sandbox boundary"],
  [/^services\/engine\/learnquest_engine\/prompts\//, "engine prompt"],
  [/^scripts\/(merge-gate|agent-merge|agent-verify|deploy|render|assert-main)/, "merge or deploy tooling"],
];

export function sensitivePaths(paths: string[]): { path: string; why: string }[] {
  return paths.flatMap((path) => {
    const hit = SENSITIVE.find(([re]) => re.test(path));
    return hit ? [{ path, why: hit[1] }] : [];
  });
}

const PASSING = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

export function evaluateGate(pr: PullRequest, options: GateOptions): string[] {
  const reasons: string[] = [];
  if (pr.state !== "OPEN") reasons.push(`PR is ${pr.state}, not OPEN`);
  if (pr.isDraft) reasons.push("PR is a draft");
  if (pr.mergeable === "CONFLICTING") reasons.push("PR has merge conflicts");
  if (pr.reviewDecision === "CHANGES_REQUESTED") reasons.push("a reviewer requested changes");
  if (options.unresolvedThreads > 0) reasons.push(`${options.unresolvedThreads} unresolved review thread(s)`);

  if (pr.statusCheckRollup.length === 0) reasons.push("no checks have reported on the head commit");
  for (const check of pr.statusCheckRollup) {
    const name = check.name ?? check.context ?? "unnamed check";
    const outcome = check.conclusion ?? check.state ?? "";
    if (check.status && check.status !== "COMPLETED") reasons.push(`check "${name}" is still ${check.status.toLowerCase()}`);
    else if (!PASSING.has(outcome)) reasons.push(`check "${name}" is ${outcome.toLowerCase() || "not passing"}`);
  }

  if (options.revertRate !== undefined && options.revertRate !== null && options.revertRate > REVERT_RATE_LIMIT) {
    const pct = (options.revertRate * 100).toFixed(1);
    reasons.push(`revert rate is ${pct}% over the last 30 days, above ${REVERT_RATE_LIMIT * 100}%. Agents stop self-merging until it falls; a human merges`);
  }

  const sensitive = sensitivePaths(pr.files.map((f) => f.path));
  if (sensitive.length > 0 && !options.sensitive) {
    const list = sensitive.slice(0, 5).map((s) => `${s.path} (${s.why})`).join(", ");
    reasons.push(`touches sensitive paths: ${list}. Re-run with --sensitive once a reviewer agent has approved the diff`);
  }
  return reasons;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function unresolvedThreadCount(number: string): number {
  const query = `query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}}}}}`;
  const repo = JSON.parse(gh(["repo", "view", "--json", "owner,name"])) as { owner: { login: string }; name: string };
  const out = JSON.parse(
    gh(["api", "graphql", "-f", `query=${query}`, "-F", `owner=${repo.owner.login}`, "-F", `repo=${repo.name}`, "-F", `n=${number}`]),
  ) as { data: { repository: { pullRequest: { reviewThreads: { nodes: { isResolved: boolean }[] } } } } };
  return out.data.repository.pullRequest.reviewThreads.nodes.filter((t) => !t.isResolved).length;
}

function main(argv: string[]): number {
  const number = argv.find((a) => /^\d+$/.test(a));
  if (!number) {
    console.error("usage: node scripts/merge-gate.ts <pr-number> [--sensitive] [--dry-run] [--skip-local]");
    return 2;
  }
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  const pr = JSON.parse(
    gh(["pr", "view", number, "--json", "state,isDraft,headRefOid,reviewDecision,mergeable,files,statusCheckRollup"]),
  ) as PullRequest;
  const revertRate = computeRevertRate(parseLog(readFirstParentLog(root)), Date.now(), 30).overall.rate;
  const reasons = evaluateGate(pr, { sensitive: flags.has("--sensitive"), unresolvedThreads: unresolvedThreadCount(number), revertRate });
  if (reasons.length > 0) {
    console.error(`Not merging PR #${number}:`);
    for (const r of reasons) console.error(`  - ${r}`);
    return 1;
  }

  if (!flags.has("--skip-local")) {
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
