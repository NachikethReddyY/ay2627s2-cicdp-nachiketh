import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bin } from "./bin.ts";

export type Commit = { sha: string; timestamp: number; subject: string };
export type Tally = { changes: number; reverts: number; rate: number | null };
export type WeekTally = Tally & { week: string };
export type RevertReport = { days: number; windowStart: string; overall: Tally; weeks: WeekTally[] };

const FIELD_SEPARATOR = "\x1f";
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DEFAULT_DAYS = 30;

export function parseLog(text: string): Commit[] {
  return text
    .split("\n")
    .filter((line) => line.includes(FIELD_SEPARATOR))
    .map((line) => {
      const [sha = "", seconds = "", ...subjectParts] = line.split(FIELD_SEPARATOR);
      return { sha, timestamp: Number(seconds) * 1000, subject: subjectParts.join(FIELD_SEPARATOR) };
    });
}

function isRevert(subject: string): boolean {
  return subject.startsWith('Revert "') || subject.startsWith("revert");
}

function isoWeekKey(timestamp: number): string {
  const date = new Date(timestamp);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday + 3));
  const yearOfWeek = thursday.getUTCFullYear();
  const weekNumber = Math.floor((thursday.getTime() - Date.UTC(yearOfWeek, 0, 1)) / WEEK_MS) + 1;
  return `${yearOfWeek}-W${String(weekNumber).padStart(2, "0")}`;
}

function tally(commits: Commit[]): Tally {
  const reverts = commits.filter((commit) => isRevert(commit.subject)).length;
  const changes = commits.length - reverts;
  return { changes, reverts, rate: changes === 0 ? null : reverts / changes };
}

export function computeRevertRate(commits: Commit[], now: number, days: number): RevertReport {
  const windowStart = now - days * DAY_MS;
  const inWindow = commits.filter((commit) => commit.timestamp >= windowStart && commit.timestamp <= now);
  const commitsByWeek = new Map<string, Commit[]>();
  for (const commit of inWindow) {
    const week = isoWeekKey(commit.timestamp);
    commitsByWeek.set(week, [...(commitsByWeek.get(week) ?? []), commit]);
  }
  const weeks = [...commitsByWeek]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([week, weekCommits]) => ({ week, ...tally(weekCommits) }));
  return { days, windowStart: new Date(windowStart).toISOString(), overall: tally(inWindow), weeks };
}

function refExists(repoDir: string, ref: string): boolean {
  return spawnSync(bin("git"), ["-C", repoDir, "rev-parse", "--verify", "--quiet", ref], { encoding: "utf8" }).status === 0;
}

export function readFirstParentLog(repoDir: string): string {
  const ref = refExists(repoDir, "origin/main") ? "origin/main" : "main";
  return execFileSync(
    bin("git"),
    ["-C", repoDir, "log", "--first-parent", "--format=%H%x1f%ct%x1f%s", ref],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
}

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

function tableRow(label: string, value: Tally): string {
  return [
    label.padEnd(10),
    String(value.changes).padStart(8),
    String(value.reverts).padStart(8),
    percent(value.rate).padStart(8),
  ].join("  ");
}

export function formatTable(report: RevertReport): string {
  const header = `Revert rate, last ${report.days} days (since ${report.windowStart.slice(0, 10)})`;
  const columns = ["Week".padEnd(10), "Changes".padStart(8), "Reverts".padStart(8), "Rate".padStart(8)].join("  ");
  const weekRows = report.weeks.map((week) => tableRow(week.week, week));
  const body = weekRows.length === 0 ? ["No changes in this window."] : weekRows;
  return [header, "", columns, ...body, "", tableRow("Overall", report.overall)].join("\n");
}

export function parseArgs(argv: string[]): { days: number; json: boolean } {
  const daysIndex = argv.indexOf("--days");
  const days = daysIndex === -1 ? DEFAULT_DAYS : Number(argv[daysIndex + 1]);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days needs a whole number of at least 1");
  return { days, json: argv.includes("--json") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { days, json } = parseArgs(process.argv.slice(2));
  const report = computeRevertRate(parseLog(readFirstParentLog(process.cwd())), Date.now(), days);
  console.log(json ? JSON.stringify(report, null, 2) : formatTable(report));
}
