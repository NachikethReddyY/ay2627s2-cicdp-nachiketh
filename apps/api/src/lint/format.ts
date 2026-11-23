import { diffArrays } from "diff";
import type { Finding } from "./index.ts";

export type Formatter = "Prettier" | "Ruff";

const sourceLines = (code: string) => code.split(/\r\n|\n|\r/);

export function formatFindings(code: string, formatted: string, formatter: Formatter): Finding[] {
  const original = sourceLines(code);
  const revised = sourceLines(formatted);
  const ruleId = formatter === "Ruff" ? "ruff-format" : "prettier-format";
  const message = `Check the formatting here with ${formatter}.`;
  const changes = diffArrays(original, revised, { maxEditLength: 128 });
  if (!changes) {
    const firstChange = original.findIndex((value, i) => value !== revised[i]);
    return [{ ruleId, line: firstChange === -1 ? original.length : firstChange + 1, column: 1, message }];
  }

  const findings: Finding[] = [];
  let line = 1;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      line += change.count;
      continue;
    }

    const next = changes[i + 1];
    const replacement = change.removed && next?.added ? next : undefined;
    if (replacement) i++;
    const suggestion = (replacement ?? (change.added ? change : undefined))?.value.join("\n").trimEnd();
    const location = Math.min(line, original.length);
    findings.push({
      ruleId,
      line: location,
      column: line > original.length ? original[location - 1].length + 1 : 1,
      message: suggestion && suggestion.length <= 120 && suggestion.split("\n").length <= 3
        ? `${formatter} formatting suggestion\n${suggestion}`
        : message,
    });
    if (change.removed) line += change.count;
  }
  return findings;
}
