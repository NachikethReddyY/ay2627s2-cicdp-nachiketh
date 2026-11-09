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
  id: string; name: string; stretch: boolean; status: TestStatus; label: string;
  detail?: { stdin?: string; expectedStdout?: string; actualStdout?: string; error?: string };
};

export function toRows(results: CheckResult[]): CheckRow[] {
  return results.map((r) => {
    const row: CheckRow = { id: r.id, name: r.name, stretch: r.stretch, status: r.status, label: statusLabel(r.status) };
    // Decide by visibility, never by whether the fields happen to be there: a hidden test never shows data.
    if (r.visibility === "sample") {
      row.detail = { stdin: r.stdin, expectedStdout: r.expectedStdout, actualStdout: r.status === "pass" ? undefined : r.actualStdout, error: r.error };
    }
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

/** Sloppy shows only when the server says the guide is on. Anything else (disabled, bad body, failed request) hides it. */
export const guideEnabled = (body: unknown): boolean => typeof body === "object" && body !== null && (body as { enabled?: unknown }).enabled === true;
