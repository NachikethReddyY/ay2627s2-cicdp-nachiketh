import type { ReactNode } from "react";
import type { LintFinding } from "../runPython";
import { bonusRows, previewRows, requiredRows, scoreLine, toRows, type CheckResponse, type CheckRow, type PracticeTest } from "./checkModel";
import { askLabel, lintSummary } from "./lintModel";

const badge = (s: CheckRow["status"]) => (s === "pass" ? "bg-[var(--ok)] text-white" : s === "locked" || s === "idle" ? "bg-[var(--pane2)] text-[var(--mu)]" : "bg-[var(--bad)] text-white");

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mu)]">{label}</div>
      <pre className="wb-mono m-0 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--pane2)] px-2 py-1.5 text-xs">{text === "" ? "(empty)" : text}</pre>
    </div>
  );
}

function Row({ row }: { row: CheckRow }) {
  const d = row.detail;
  return (
    <li className="rounded-lg border border-[var(--line)] p-2">
      <div className="flex items-center gap-2">
        {row.locked && <span role="img" aria-label="Locked test" title="Locked test">🔒</span>}
        <span className="min-w-0 flex-1 font-semibold">{row.name}</span>
        <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${badge(row.status)}`}>{row.label}</span>
      </div>
      {d && (d.stdin !== undefined || d.actualStdout !== undefined || d.error) && (
        <div>
          {d.stdin !== undefined && <Block label="Input" text={d.stdin} />}
          {d.actualStdout !== undefined && <Block label="Your output" text={d.actualStdout} />}
          {d.error && <Block label="Error" text={d.error} />}
        </div>
      )}
    </li>
  );
}

const alert = (text: string) => <p role="alert" className="m-0 mb-2 rounded-lg bg-[var(--bad)] px-3 py-2 text-xs font-semibold text-white">{text}</p>;

type Props = {
  children?: ReactNode;
  result: CheckResponse | null;
  tests?: PracticeTest[];
  checkError: string;
  findings: LintFinding[] | null;
  lintError: string;
  onAsk(finding: LintFinding): void;
};

export default function LessonResults({ children, result, tests, checkError, findings, lintError, onAsk }: Props) {
  const rows = result ? toRows(result.results) : previewRows(tests ?? []);
  const required = requiredRows(rows);
  const bonus = bonusRows(rows);
  return (
    <div className="wb-prose min-h-0 flex-1 overflow-auto px-3 py-2.5">
      {checkError && alert(checkError)}
      {lintError && alert(lintError)}
      {rows.length > 0 && (
        <section aria-labelledby="check-h">
          <h3 id="check-h" className="wb-sec h-[22px] p-0">Check results</h3>
          {result?.complete && <p role="status" className="my-2 rounded-lg bg-[var(--ok)] px-3 py-1.5 text-xs font-semibold text-white">Level complete! Every required test passed.</p>}
          {result && <p className="my-1 text-xs font-semibold" data-testid="score-line">{scoreLine(result)}</p>}
          <ul aria-label="Required tests" className="m-0 flex list-none flex-col gap-2 p-0">
            {required.map((r) => <Row key={r.id} row={r} />)}
          </ul>
          {bonus.length > 0 && (
            <>
              <h4 className="mb-1 mt-3 text-xs font-semibold">Bonus</h4>
              <ul aria-label="Bonus tests" className="m-0 flex list-none flex-col gap-2 p-0">
                {bonus.map((r) => <Row key={r.id} row={r} />)}
              </ul>
            </>
          )}
        </section>
      )}
      {children}
      {findings !== null && (
        <section aria-labelledby="lint-h" className="mt-3">
          <h3 id="lint-h" className="wb-sec h-[22px] p-0">Style findings</h3>
          <p role="status" className="m-0 mt-1 text-xs font-semibold">{lintSummary(findings.length)}</p>
          {findings.length > 0 && (
            <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
              {findings.map((f, i) => (
                <li key={`${f.line}-${f.column}-${f.ruleId}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-1.5">
                  <span className="wb-mono flex-none text-xs font-semibold">Line {f.line}</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs">{f.message}</span>
                  <button type="button" aria-label={askLabel(f)} onClick={() => onAsk(f)} className="wb-tb wb-outline flex-none px-2.5 text-xs">Ask Sloppy</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {rows.length === 0 && findings === null && !checkError && !lintError && <p className="m-0 text-xs text-[var(--mu)]">Choose Submit to run the tests, or Lint to check style and formatting.</p>}
    </div>
  );
}
