import { Link } from "@tanstack/react-router";
import type { RouterOutputs } from "../lib/trpc";
import "./home.css";

type Dashboard = RouterOutputs["admin"]["dashboard"];
type Totals = Dashboard["monthToDate"];

const count = new Intl.NumberFormat();
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 8 });

function EstimatedSpend({ estimatedUsd, unpricedCalls, calls }: Totals) {
  return (
    <>
      {calls > 0 && calls === unpricedCalls ? "Unavailable" : usd.format(estimatedUsd)}
      {unpricedCalls > 0 && <span className="block text-sm">{count.format(unpricedCalls)} {unpricedCalls === 1 ? "call" : "calls"} unpriced</span>}
    </>
  );
}

function SpendRow({ label, totals }: { label: string; totals: Totals }) {
  return (
    <tr className="border-t border-current/15">
      <th scope="row" className="px-3 py-3 text-left font-medium">{label}</th>
      <td className="px-3 py-3">{count.format(totals.calls)}</td>
      <td className="px-3 py-3">{count.format(totals.promptTokens)}</td>
      <td className="px-3 py-3">{count.format(totals.completionTokens)}</td>
      <td className="px-3 py-3">{count.format(totals.promptTokens + totals.completionTokens)}</td>
      <td className="px-3 py-3"><EstimatedSpend {...totals} /></td>
    </tr>
  );
}

export default function Admin({ dashboard }: { dashboard: Dashboard }) {
  const { monthToDate, days } = dashboard;
  return (
    <div className="lq lq-moon">
      <main className="lq-wrap grid gap-5">
        <Link to="/account" className="lq-topnav-link mt-6 justify-self-start">Back to account</Link>
        <h1 className="lq-hero-title">AI spend</h1>
        <section className="lq-card grid gap-4 p-5 sm:p-7" aria-labelledby="spend-period">
          <h2 id="spend-period" className="text-lg">Month to date (UTC)</h2>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Daily AI spend">
            <table className="w-full min-w-max text-right tabular-nums">
              <thead>
                <tr>
                  <th scope="col" className="px-3 pb-3 text-left">Day</th>
                  <th scope="col" className="px-3 pb-3">Calls</th>
                  <th scope="col" className="px-3 pb-3">Prompt tokens</th>
                  <th scope="col" className="px-3 pb-3">Completion tokens</th>
                  <th scope="col" className="px-3 pb-3">Total tokens</th>
                  <th scope="col" className="px-3 pb-3">Estimated USD</th>
                </tr>
              </thead>
              <tbody>
                <SpendRow label="Month to date" totals={monthToDate} />
                {days.map(({ day, ...totals }) => <SpendRow key={day} label={day} totals={totals} />)}
              </tbody>
            </table>
          </div>
          {days.length === 0 && <p>No AI calls recorded this month.</p>}
        </section>
      </main>
    </div>
  );
}
