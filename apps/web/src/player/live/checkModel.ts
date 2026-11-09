// UI model for a multi-test Check. Pure functions, so the rules (hidden tests never show their data) are unit tested.

export type PracticeLanguage = "python" | "javascript" | "typescript";
export type TestStatus = "pass" | "fail" | "timeout" | "error";
export type Visibility = "sample" | "hidden";

/** A test as the lesson part lists it (from lessons.get). Hidden tests carry no stdin or expected output. */
export type PracticeTest = { id: string; name: string; visibility: Visibility; stretch: boolean; stdin?: string; expectedStdout?: string };

/** One result from POST /api/sandbox/check. The data fields are only meant to be present for sample tests. */
export type CheckResult = {
  id: string; name: string; stretch: boolean; visibility: Visibility; status: TestStatus;
  stdin?: string; expectedStdout?: string; actualStdout?: string; error?: string;
};
export type CheckResponse = {
  results: CheckResult[];
  required: { passed: number; total: number };
  stretch: { passed: number; total: number };
  points: number; maxPoints: number; complete: boolean;
  best: { points: number; maxPoints: number };
};

export const STATUS_LABEL: Record<TestStatus, string> = { pass: "✓ Passed", fail: "✗ Failed", timeout: "Timed out", error: "Error" };
export const statusLabel = (s: TestStatus) => STATUS_LABEL[s] ?? "Error";

/** A row the UI draws. `detail` exists only for sample tests; hidden rows are name and status only. */
export type CheckRow = {
  id: string; name: string; stretch: boolean; status: TestStatus | "locked" | "idle"; label: string;
  /** True for a hidden test: the row shows a lock icon and a name, never data. */
  locked: boolean;
  detail?: { stdin?: string; expectedStdout?: string; actualStdout?: string; error?: string };
};

export function toRows(results: CheckResult[]): CheckRow[] {
  return results.map((r) => {
    const row: CheckRow = { id: r.id, name: r.name, stretch: r.stretch, status: r.status, label: statusLabel(r.status), locked: r.visibility !== "sample" };
    // Decide by visibility, never by whether the fields happen to be there: a hidden test never shows data.
    if (r.visibility === "sample") {
      row.detail = { stdin: r.stdin, expectedStdout: r.expectedStdout, actualStdout: r.status === "pass" ? undefined : r.actualStdout, error: r.error };
    }
    return row;
  });
}

/** Rows before the first check: a hidden test reads "Locked"; a sample test shows its input and expected output. */
export function previewRows(tests: PracticeTest[]): CheckRow[] {
  return tests.map((t) => {
    const sample = t.visibility === "sample";
    const row: CheckRow = { id: t.id, name: t.name, stretch: t.stretch, status: sample ? "idle" : "locked", label: sample ? "Not run" : "Locked", locked: !sample };
    if (sample) row.detail = { stdin: t.stdin, expectedStdout: t.expectedStdout };
    return row;
  });
}

export const requiredRows = (rows: CheckRow[]) => rows.filter((r) => !r.stretch);
export const bonusRows = (rows: CheckRow[]) => rows.filter((r) => r.stretch);

export function scoreLine(c: Pick<CheckResponse, "required" | "stretch" | "points" | "maxPoints" | "best">): string {
  const bonus = Math.max(0, c.points - c.required.passed);
  return `${c.required.passed} of ${c.required.total} required passed · ${bonus} bonus points · best ${c.best.points}/${c.best.maxPoints}`;
}

/** The practice file name per language (also the guide's file name). */
export const solutionFile = (l: PracticeLanguage) => (l === "python" ? "solution.py" : l === "typescript" ? "solution.ts" : "solution.js");
/** The editor language; unknown values fall back to JavaScript. */
export const monacoLanguage = (l: string | undefined): PracticeLanguage => (l === "python" || l === "typescript" ? l : "javascript");

