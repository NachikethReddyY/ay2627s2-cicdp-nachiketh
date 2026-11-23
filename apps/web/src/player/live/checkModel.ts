
export type PracticeLanguage = "python" | "javascript" | "typescript";
export type TestStatus = "pass" | "fail" | "timeout" | "error";
export type Visibility = "sample" | "hidden";

export type PracticeTest = { id: string; name: string; visibility: Visibility; stretch: boolean; stdin?: string };

export type CheckResult = {
  id: string; name: string; stretch: boolean; visibility: Visibility; status: TestStatus;
  stdin?: string; actualStdout?: string; error?: string;
};
export type CheckResponse = {
  results: CheckResult[];
  required: { passed: number; total: number };
  stretch: { passed: number; total: number };
  points: number; maxPoints: number; complete: boolean;
  best: { points: number; maxPoints: number };
  attemptCount: number;
};

export const STATUS_LABEL: Record<TestStatus, string> = { pass: "✓ Passed", fail: "✗ Failed", timeout: "Timed out", error: "Error" };
export const statusLabel = (s: TestStatus) => STATUS_LABEL[s] ?? "Error";

export type CheckRow = {
  id: string; name: string; stretch: boolean; status: TestStatus | "locked" | "idle"; label: string;
  locked: boolean;
  detail?: { stdin?: string; actualStdout?: string; error?: string };
};

export function toRows(results: CheckResult[]): CheckRow[] {
  return results.map((r) => {
    const row: CheckRow = { id: r.id, name: r.name, stretch: r.stretch, status: r.status, label: statusLabel(r.status), locked: r.visibility !== "sample" };
    if (r.visibility === "sample") {
      row.detail = { stdin: r.stdin, actualStdout: r.status === "pass" ? undefined : r.actualStdout, error: r.error };
    }
    return row;
  });
}

export function previewRows(tests: PracticeTest[]): CheckRow[] {
  return tests.map((t) => {
    const sample = t.visibility === "sample";
    const row: CheckRow = { id: t.id, name: t.name, stretch: t.stretch, status: sample ? "idle" : "locked", label: sample ? "Not run" : "Locked", locked: !sample };
    if (sample) row.detail = { stdin: t.stdin };
    return row;
  });
}

export const requiredRows = (rows: CheckRow[]) => rows.filter((r) => !r.stretch);
export const bonusRows = (rows: CheckRow[]) => rows.filter((r) => r.stretch);

export function scoreLine(c: Pick<CheckResponse, "required" | "stretch" | "points" | "maxPoints" | "best">): string {
  const bonus = Math.max(0, c.points - c.required.passed);
  return `${c.required.passed} of ${c.required.total} required passed · ${bonus} bonus points · best ${c.best.points}/${c.best.maxPoints}`;
}

export const solutionFile = (l: PracticeLanguage) => (l === "python" ? "solution.py" : l === "typescript" ? "solution.ts" : "solution.js");
export const monacoLanguage = (l: string | undefined): PracticeLanguage => (l === "python" || l === "typescript" ? l : "javascript");

