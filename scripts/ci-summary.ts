import { readFileSync } from "node:fs";

export type WorkflowJob = {
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
};

type Evidence = {
  apiCoverage?: string;
  e2eResult?: string;
  e2eReportUrl?: string;
};

const checks = [
  ["lint", "TypeScript and Python lint and type checks"],
  ["unit", "API and Postgres integration, web and package tests, builds, and repo guardrails"],
  ["engine", "Lesson and quiz generation, mastery updates, and the LiteLLM advisory check"],
  ["deploy-scripts", "Stale-commit protection, deploy hooks, routing config, and simulated smoke checks"],
  ["e2e", "Chromium tests for sign-in, learning, practice, replay, and accessibility"],
] as const;

const productionJobs = [
  ["Prod / Images", "Publish the API and engine images"],
  ["Prod / Migrate", "Apply production Postgres migrations"],
  ["Prod / Rollout", "Roll out services on Render and Vercel"],
  ["Prod / Verify", "Verify the live commit, health, auth, and web routing"],
] as const;

const failedConclusions = new Set(["failure", "timed_out", "startup_failure", "action_required", "cancelled"]);

function duration(job: WorkflowJob | undefined) {
  if (!job?.started_at || !job.completed_at || job.conclusion === "skipped") return "—";
  const seconds = Math.round((Date.parse(job.completed_at) - Date.parse(job.started_at)) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function renderCiSummary(
  jobs: WorkflowJob[],
  event: string,
  productionResult: string,
  { apiCoverage, e2eResult, e2eReportUrl }: Evidence = {},
) {
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const showProduction = event === "push";
  const stages = showProduction ? [...checks, ...productionJobs] : checks;
  const failures = stages.flatMap(([name]) => {
    const job = byName.get(name);
    return job?.conclusion && failedConclusions.has(job.conclusion) ? [`[${name}](${job.html_url})`] : [];
  });
  const evidenceByName = {
    unit: apiCoverage,
    e2e: [e2eResult, e2eReportUrl ? `[Playwright report](${e2eReportUrl})` : ""].filter(Boolean).join(" · "),
  };

  function table(stages: ReadonlyArray<readonly [string, string]>, fallback: string) {
    return [
      "| Job | Result | Duration | What it checks |",
      "| --- | --- | --- | --- |",
      ...stages.map(([name, description]) => {
        const job = byName.get(name);
        const label = job ? `[${name}](${job.html_url})` : name;
        const evidence = name === "unit" || name === "e2e" ? evidenceByName[name] : "";
        return `| ${label} | ${job?.conclusion ?? fallback} | ${duration(job)} | ${description}${evidence ? ` · ${evidence}` : ""} |`;
      }),
      "",
    ];
  }

  return [
    "## CI results",
    "",
    ...(failures.length ? [`**Needs attention:** ${failures.join(", ")}`, ""] : []),
    "### Parallel checks",
    "",
    ...table(checks, "unavailable"),
    ...(showProduction
      ? ["### Production", "", ...table(productionJobs, productionResult === "skipped" ? "skipped" : "unavailable")]
      : []),
  ].join("\n");
}

if (import.meta.main) {
  const jobs = JSON.parse(readFileSync(0, "utf8")) as WorkflowJob[];
  process.stdout.write(renderCiSummary(jobs, process.env.GITHUB_EVENT_NAME ?? "", process.env.PRODUCTION_RESULT ?? "", {
    apiCoverage: process.env.API_COVERAGE,
    e2eResult: process.env.E2E_RESULT,
    e2eReportUrl: process.env.E2E_REPORT_URL,
  }));
}
