import type { LintFinding } from "../runPython";
import { FOCUS } from "../ui";
import { askLabel, lintSummary } from "./lintModel";

// Style findings for the learner's code, from the server's lint. Each row can hand its rule and line to Sloppy.
export default function LintFindings({ findings, onAsk }: { findings: LintFinding[] | null; onAsk: (finding: LintFinding) => void }) {
  if (findings === null) return null;
  return (
    <section aria-labelledby="lint-h" className="flex-none border-t-[3px] border-ink bg-white px-3 py-2 text-sm">
      <h3 id="lint-h" className="m-0 text-sm font-extrabold">Style findings</h3>
      <p role="status" className="m-0 mt-1 font-semibold">{lintSummary(findings.length)}</p>
      {findings.length > 0 && (
        <ul className="m-0 mt-1 flex max-h-40 list-none flex-col gap-1 overflow-auto p-0">
          {findings.map((f, i) => (
            <li key={`${f.line}-${f.column}-${f.ruleId}-${i}`} className="flex items-center gap-2 rounded-lg border-2 border-ink p-1.5">
              <span className="flex-none font-mono font-extrabold">Line {f.line}</span>
              <span className="min-w-0 flex-1 font-semibold">{f.message}</span>
              <button type="button" aria-label={askLabel(f)} onClick={() => onAsk(f)} className={`pill min-h-7 flex-none bg-sun px-3 text-sm font-extrabold ${FOCUS}`}>Ask Sloppy</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
