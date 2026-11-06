import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useApi, type ExplorePath } from "../lib/api";
import { trpc } from "../lib/trpc";
import TopNav from "../components/TopNav";
import { AiBadge, Page, Spinner } from "../components/Bits";
import "./home.css";
import "./explore.css";

const tabs = [["official", "Official"], ["community", "Community"], ["mine", "Mine"]] as const;
const tones = ["lq-bg-lilac lq-tl2", "lq-bg-pink lq-tr", "lq-bg-mint lq-tl", "lq-bg-sun lq-tr2"];

function Publish({ p, onDone }: { p: ExplorePath; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "error">("idle");
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state === "confirm") confirmRef.current?.focus();
  }, [state]);
  if (state === "idle" || state === "error")
    return (
      <div className="explore-pub">
        <button type="button" className="lq-btn lq-btn-surface lq-btn-sm" onClick={() => setState("confirm")}>Publish</button>
        {state === "error" && <p role="alert" className="explore-pub-err">Couldn't publish. Try again.</p>}
      </div>
    );
  return (
    <div role="group" aria-label={`Publish ${p.title}`} className="explore-confirm">
      <span>Make this path public?</span>
      <button ref={confirmRef} type="button" disabled={state === "busy"} className="lq-btn lq-btn-sun lq-btn-sm"
        onClick={() => { setState("busy"); trpc.paths.publish.mutate({ slug: p.slug }).then(onDone, () => setState("error")); }}>
        Yes, publish
      </button>
      <button type="button" disabled={state === "busy"} className="lq-btn lq-btn-surface lq-btn-sm" onClick={() => setState("idle")}>Cancel</button>
    </div>
  );
}

function Row({ p, onDone, scope, tone }: { p: ExplorePath; onDone: () => void; scope: string; tone: string }) {
  const [busy, setBusy] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  return (
    <li className={`lq-card lq-cc lq-lift explore-card ${tone}`}>
      <div className="explore-card-head">
        <div className="explore-card-title">
          <h2>
            {p.title}
            {p.origin === "ai" && <span className="explore-ai"><AiBadge /></span>}
          </h2>
          <p className="explore-tagline">{p.tagline}</p>
          <p className="explore-meta">{p.courseCount} {p.courseCount === 1 ? "course" : "courses"} · {p.learners} {p.learners === 1 ? "learner" : "learners"}</p>
        </div>
        {scope === "mine" && p.visibility === "private" ? (
          <Publish p={p} onDone={onDone} />
        ) : p.enrolled ? (
          <span className="lq-sticker lq-bg-mint explore-joined">Joined ✓</span>
        ) : (
          <div>
            <button type="button" disabled={busy} className="lq-btn lq-btn-surface lq-btn-sm"
              onClick={() => { setBusy(true); setJoinFailed(false); trpc.paths.enroll.mutate({ slug: p.slug }).then(onDone, () => setJoinFailed(true)).finally(() => setBusy(false)); }}>
              Join
            </button>
            {joinFailed && <p role="alert" className="mt-1 text-sm font-bold">Couldn't join. Try again.</p>}
          </div>
        )}
      </div>
      <ul className="explore-courses">
        {p.courses.map((c) => (
          <li key={c.slug}><Link to="/courses/$slug" params={{ slug: c.slug }} className="explore-tag">{c.title}</Link></li>
        ))}
      </ul>
    </li>
  );
}

// Hand-picked collections, shown above the community list. Stays quiet (renders nothing) if there are none or the load fails,
// so a curation problem never hides the paths below it.
function Collections({ onDone }: { onDone: () => void }) {
  const { data, error, reload } = useApi("collections", () => trpc.collections.list.query());
  if (error || (data && data.length === 0)) return null;
  if (!data) return <div className="explore-collections" aria-busy="true"><Spinner /></div>;
  return (
    <div className="explore-collections">
      {data.map((c) => (
        <section key={c.slug} aria-labelledby={`col-${c.slug}`} className="explore-collection">
          <h2 id={`col-${c.slug}`} className="explore-col-h">{c.title}</h2>
          {c.description && <p className="explore-col-desc">{c.description}</p>}
          <ul className="lq-comm explore-list">
            {c.paths.map((p, i) => <Row key={p.slug} p={p} onDone={() => { reload(); onDone(); }} scope="official" tone={tones[i % 4]} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function Explore() {
  const [scope, setScope] = useState<(typeof tabs)[number][0]>("official");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, reload } = useApi(`paths:${scope}:${dq}`, () => trpc.paths.list.query({ scope, q: dq || undefined }));

  return (
    <div className="lq lq-explore">
      <TopNav />
      <Page>
        <div className="explore-page">
          <h1 className="explore-h">Explore</h1>
          <div className="explore-filters">
            <div role="group" aria-label="Path source" className="explore-tabs">
              {tabs.map(([v, label]) => (
                <button key={v} type="button" aria-pressed={scope === v} onClick={() => setScope(v)}
                  className="lq-chip explore-tab">{label}</button>
              ))}
            </div>
            <div className="explore-search-wrap">
              <label htmlFor="q" className="sr-only">Search paths</label>
              <input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search paths"
                className="explore-search" />
            </div>
          </div>
          {scope !== "mine" && !dq && <Collections onDone={reload} />}
          <div className="explore-results">
            {error ? (
              <div className="lq-empty-card">
                <img src="/img/pip-oops.png" alt="" />
                <div><p>Couldn't load paths.</p></div>
              </div>
            ) : !data ? <Spinner /> : data.length === 0 ? (
              <div className="lq-empty-card">
                <img src="/img/pip-think.png" alt="" />
                <div><p>{scope === "mine" ? "You haven't joined or made any paths yet." : "Nothing here yet."}</p></div>
              </div>
            ) : (
              <ul className="lq-comm explore-list">
                {data.map((p, i) => <Row key={p.slug} p={p} onDone={reload} scope={scope} tone={tones[i % 4]} />)}
              </ul>
            )}
          </div>
        </div>
      </Page>
    </div>
  );
}
