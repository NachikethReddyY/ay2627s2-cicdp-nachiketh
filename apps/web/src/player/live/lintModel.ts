import { ApiError, type LintFinding } from "../runPython.ts";

/** What the learner sees when a lint request fails; a 503 means the lint service is busy. */
export const lintErrorMessage = (e: unknown) =>
  e instanceof ApiError && e.status === 503 ? "Lint is busy, try again soon" : e instanceof Error ? e.message : "Could not lint the code";

export const askLabel = (f: Pick<LintFinding, "line" | "ruleId">) => `Ask Sloppy about line ${f.line}: ${f.ruleId}`;

/** The pointer sent to the guide: rule, line and column only, never the code or the message. */
export const findingPointer = (f: Pick<LintFinding, "ruleId" | "line" | "column">) => ({ ruleId: f.ruleId, line: f.line, column: f.column });

/** The polite status line announced when a lint finishes. */
export const lintSummary = (n: number) => (n === 0 ? "No style issues found." : `${n} ${n === 1 ? "issue" : "issues"} found.`);
