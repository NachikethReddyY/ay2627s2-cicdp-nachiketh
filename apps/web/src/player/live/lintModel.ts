import { ApiError, type LintFinding } from "../runPython.ts";

export const lintErrorMessage = (e: unknown) =>
  e instanceof ApiError && e.status === 503 ? "Lint is busy, try again soon" : e instanceof Error ? e.message : "Could not lint the code";

export const askLabel = (f: Pick<LintFinding, "line" | "ruleId">) => `Ask Sloppy about line ${f.line}: ${f.ruleId}`;

export const findingPointer = (f: Pick<LintFinding, "ruleId" | "line" | "column">) => ({ ruleId: f.ruleId, line: f.line, column: f.column });

export const lintSummary = (n: number) => (n === 0 ? "No style issues found." : `${n} ${n === 1 ? "issue" : "issues"} found.`);
