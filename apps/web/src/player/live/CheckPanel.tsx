import { bonusRows, requiredRows, scoreLine, toRows, type CheckResponse, type CheckRow } from "./checkModel";

const tone = (s: CheckRow["status"]) => (s === "pass" ? "bg-green" : s === "fail" ? "bg-pink" : "bg-sun");

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-1">
      <div className="text-xs font-extrabold uppercase tracking-wide text-muted">{label}</div>
      <pre className="m-0 overflow-auto rounded-lg border-2 border-ink bg-white p-2 font-mono text-xs whitespace-pre-wrap">{text === "" ? "(empty)" : text}</pre>
    </div>
  );
}

function Row({ row }: { row: CheckRow }) {
  const d = row.detail;
  return (
    <li className="rounded-lg border-2 border-ink bg-white p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 font-extrabold">{row.name}</span>
        <span className={`rounded-lg border-2 border-ink px-2 py-0.5 text-sm font-extrabold text-ink ${tone(row.status)}`}>{row.label}</span>
      </div>
      {d && (d.stdin !== undefined || d.expectedStdout !== undefined || d.actualStdout !== undefined || d.error) && (
        <div className="mt-1">
          {d.stdin !== undefined && <Block label="Input" text={d.stdin} />}
          {d.expectedStdout !== undefined && <Block label="Expected output" text={d.expectedStdout} />}
          {d.actualStdout !== undefined && <Block label="Your output" text={d.actualStdout} />}
          {d.error && <Block label="Error" text={d.error} />}
        </div>
      )}
    </li>
  );
}

// Per-test results of a Check: required tests, then a separate Bonus group. Hidden tests show a name and a status only.
export default function CheckPanel({ result }: { result: CheckResponse }) {
  const rows = toRows(result.results);
  const required = requiredRows(rows);
  const bonus = bonusRows(rows);
  return (
    <section aria-labelledby="check-h" className="flex max-h-[50%] min-h-32 flex-none flex-col overflow-auto border-t-[3px] border-ink bg-paper p-3 text-ink">
      <h3 id="check-h" className="text-sm font-extrabold">Check results</h3>
      {result.complete && (
        <p role="status" className="verdict-ok my-2 rounded-lg border-2 border-ink bg-green px-3 py-1.5 font-extrabold">Level complete! Every required test passed.</p>
      )}
      <p className="my-1 text-sm font-bold" data-testid="score-line">{scoreLine(result)}</p>
      <ul aria-label="Required tests" className="m-0 flex list-none flex-col gap-2 p-0">
        {required.map((r) => <Row key={r.id} row={r} />)}
      </ul>
      {bonus.length > 0 && (
        <>
          <h4 className="mt-3 mb-1 text-sm font-extrabold">Bonus</h4>
          <ul aria-label="Bonus tests" className="m-0 flex list-none flex-col gap-2 p-0">
            {bonus.map((r) => <Row key={r.id} row={r} />)}
          </ul>
        </>
      )}
    </section>
  );
}
