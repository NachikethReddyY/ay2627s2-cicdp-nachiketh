import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRevertRate, formatTable, parseArgs, parseLog, readFirstParentLog } from "./revert-rate.ts";

const SEP = "\x1f";
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 17, 12);

const line = (sha: string, when: number, subject: string) => `${sha}${SEP}${Math.floor(when / 1000)}${SEP}${subject}`;

test("parseLog reads sha, time and subject, keeping separators inside the subject", () => {
  const [commit] = parseLog(`${line("abc", NOW, "feat: a")}${SEP}b\n`);
  assert.deepEqual(commit, { sha: "abc", timestamp: Math.floor(NOW / 1000) * 1000, subject: `feat: a${SEP}b` });
});

test("a Revert commit is one whose subject starts with Revert \" or revert", () => {
  const text = [
    line("1", NOW, 'Revert "feat: a"'),
    line("2", NOW, "revert: drop b"),
    line("3", NOW, "feat: revert button"),
  ].join("\n");
  const report = computeRevertRate(parseLog(text), NOW, 30);
  assert.deepEqual(report.overall, { changes: 1, reverts: 2, rate: 2 });
});

test("the rate is reverts over non-revert commits, per ISO week and overall, inside the window only", () => {
  const text = [
    line("a", NOW, "feat: a"),
    line("b", NOW - 1 * DAY, "feat: b"),
    line("c", NOW - 2 * DAY, 'Revert "feat: b"'),
    line("d", NOW - 40 * DAY, "feat: old"),
  ].join("\n");
  const report = computeRevertRate(parseLog(text), NOW, 30);
  assert.deepEqual(report.overall, { changes: 2, reverts: 1, rate: 0.5 });
  assert.equal(report.weeks.reduce((sum, week) => sum + week.changes, 0), 2);
});

test("ISO weeks cross the calendar year correctly", () => {
  const newYearsDay2027 = Date.UTC(2027, 0, 1, 12);
  const text = [line("a", newYearsDay2027, "feat: a"), line("b", newYearsDay2027, "feat: b")].join("\n");
  const report = computeRevertRate(parseLog(text), newYearsDay2027 + DAY, 30);
  assert.deepEqual(report.weeks.map((week) => week.week), ["2026-W53"]);
});

test("an empty window has no rate rather than a division by zero", () => {
  const report = computeRevertRate([], NOW, 30);
  assert.deepEqual(report.overall, { changes: 0, reverts: 0, rate: null });
  assert.match(formatTable(report), /No changes in this window\./);
});

test("parseArgs defaults to 30 days and rejects a bad --days", () => {
  assert.deepEqual(parseArgs([]), { days: 30, json: false });
  assert.deepEqual(parseArgs(["--days", "7", "--json"]), { days: 7, json: true });
  assert.throws(() => parseArgs(["--days", "0"]));
  assert.throws(() => parseArgs(["--days", "x"]));
});

test("reads a temporary git repo's first-parent history and counts one revert", () => {
  const dir = mkdtempSync(join(tmpdir(), "revert-rate-"));
  try {
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    for (const subject of ["feat: a", "feat: b", 'Revert "feat: a"', "feat: c"]) {
      git("commit", "-q", "--allow-empty", "-m", subject);
    }
    const report = computeRevertRate(parseLog(readFirstParentLog(dir)), Date.now(), 30);
    assert.deepEqual(report.overall, { changes: 3, reverts: 1, rate: 1 / 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
