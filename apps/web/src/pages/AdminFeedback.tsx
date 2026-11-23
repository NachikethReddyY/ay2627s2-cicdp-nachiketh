import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { RouterOutputs } from "../lib/trpc";
import { categories } from "./feedback-config";
import { Logo } from "./landing/Logo";
import "./home.css";
import "./dashboard.css";

type Reports = RouterOutputs["admin"]["feedback"];
const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Props = { page: Reports["list"] } | { report: Reports["get"] };

function Screenshot({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="grid gap-2">
      <h2>Screenshot</h2>
      {failed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status">Could not load the screenshot.</p>
          <button type="button" className="lq-btn" onClick={() => { setAttempt(attempt + 1); setFailed(false); }}>Retry</button>
        </div>
      ) : (
        <img key={attempt} src={`/api/admin/feedback/${id}/screenshot`} alt="Screenshot attached to this bug report" onError={() => setFailed(true)} className="max-h-[36rem] max-w-full rounded-lg border border-[var(--line)] object-contain" />
      )}
    </div>
  );
}

export default function AdminFeedback(props: Props) {
  const report = "report" in props ? props.report : undefined;
  return (
    <div className="lq lq-dashboard">
      <header className="lq-dashboard-header">
        <div className="lq-topbar">
          <Link to="/" className="lq-logo" aria-label="LearnSlop home"><Logo /></Link>
          <nav className="lq-topnav" aria-label="Admin">
            <Link to="/admin" className="lq-topnav-link">AI spend</Link>
            <Link to="/admin/feedback" className="lq-topnav-link">Feedback inbox</Link>
          </nav>
        </div>
      </header>
      <main className="lq-wrap grid gap-5">
        <h1>{report ? categories[report.category] : "Feedback inbox"}</h1>
        {"page" in props && (
          <section aria-label="Reports" className="lq-card grid gap-4 p-5 sm:p-7">
            {props.page.items.length ? (
              <ul className="divide-y divide-[var(--line)]">
                {props.page.items.map(({ id, category, createdAt }) => (
                  <li key={id}>
                    <Link to="/admin/feedback/$reportId" params={{ reportId: id }} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-[var(--acT)] hover:underline">
                      <span>{categories[category]}</span>
                      <time dateTime={createdAt} className="text-sm text-[var(--mu)]">{time.format(new Date(createdAt))}</time>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p>No feedback to show.</p>}
            {props.page.next && (
              <Link to="/admin/feedback" search={{ before: props.page.next }} className="lq-btn justify-self-start">Older reports</Link>
            )}
          </section>
        )}
        {report && (
          <article className="lq-card grid gap-5 p-5 sm:p-7">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="font-semibold">Reported by</dt><dd>{report.name}</dd></div>
              <div><dt className="font-semibold">Reply email</dt><dd><a href={`mailto:${encodeURIComponent(report.email).replace("%40", "@")}`}>{report.email}</a></dd></div>
              <div><dt className="font-semibold">Received</dt><dd><time dateTime={report.createdAt}>{time.format(new Date(report.createdAt))}</time></dd></div>
              {report.location && <div><dt className="font-semibold">Where it happened</dt><dd className="whitespace-pre-wrap">{report.location}</dd></div>}
            </dl>
            <section className="grid gap-2">
              <h2>{report.category === "bug" ? "Steps to reproduce" : "Details"}</h2>
              <p className="whitespace-pre-wrap">{report.details}</p>
            </section>
            {report.hasScreenshot && <Screenshot key={report.id} id={report.id} />}
          </article>
        )}
      </main>
    </div>
  );
}
