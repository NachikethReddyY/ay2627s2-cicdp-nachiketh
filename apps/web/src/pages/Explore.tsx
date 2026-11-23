import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { LayoutGrid, List } from "lucide-react";
import { usePostHog } from "@posthog/react";
import { useApi, type ExplorePath } from "../lib/api";
import { trpc } from "../lib/trpc";
import { authClient } from "../lib/auth";
import { AiBadge, Spinner } from "../components/Bits";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../components/ui/breadcrumb";
import { Input } from "../components/ui/input";
import { Logo } from "./landing/Logo";
import "./home.css";
import "./explore.css";

const tabs = [["official", "Official"], ["community", "Community"], ["mine", "Mine"]] as const;

const covers: Record<string, string> = {
  "js-foundations": "/images/covers/js-foundations.jpg",
  "sample-courses": "/images/covers/sample-courses.jpg",
};

function Publish({ p, onDone }: { p: ExplorePath; onDone: () => void }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "error">("idle");
  const posthog = usePostHog();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state === "confirm") confirmRef.current?.focus();
  }, [state]);
  if (state === "idle" || state === "error")
    return (
      <div className="explore-pub">
        <button type="button" className="pill explore-action" onClick={() => setState("confirm")}>Publish</button>
        {state === "error" && <p role="alert" className="explore-pub-err">Couldn't publish. Try again.</p>}
      </div>
    );
  return (
    <div role="group" aria-label={`Publish ${p.title}`} className="explore-confirm">
      <span>Make this path public?</span>
      <button ref={confirmRef} type="button" disabled={state === "busy"} className="btn explore-action"
        onClick={() => { setState("busy"); trpc.paths.publish.mutate({ slug: p.slug }).then(() => {
          posthog?.capture("learning_path_published", { path_origin: p.origin });
          onDone();
        }, () => setState("error")); }}>
        Yes, publish
      </button>
      <button type="button" disabled={state === "busy"} className="pill explore-action" onClick={() => setState("idle")}>Cancel</button>
    </div>
  );
}

function Row({ p, onDone, scope }: { p: ExplorePath; onDone: () => void; scope: string }) {
  const [busy, setBusy] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);
  const posthog = usePostHog();
  const navigate = useNavigate();
  const first = p.courses[0];
  const body = (
    <>
      <div className="explore-cover" aria-hidden="true"
        style={{ "--cover": covers[p.slug] ? `url("${covers[p.slug]}")` : "none" } as React.CSSProperties} />
      <div className="explore-card-title">
        <h2>
          {p.title}
          {p.origin === "ai" && <span className="explore-ai"><AiBadge /></span>}
        </h2>
        <p className="explore-tagline">{p.tagline}</p>
        <p className="explore-meta">
          <span>{p.courseCount} {p.courseCount === 1 ? "course" : "courses"}</span>
          <span>{p.learners} {p.learners === 1 ? "learner" : "learners"}</span>
        </p>
      </div>
    </>
  );
  return (
    <li className="explore-card">
      {first ? (
        <Link to="/courses/$slug" params={{ slug: first.slug }} className="explore-open">{body}</Link>
      ) : (
        <div className="explore-open">{body}</div>
      )}
      <div className="explore-card-action">
        {scope === "mine" && p.visibility === "private" ? (
          <Publish p={p} onDone={onDone} />
        ) : p.enrolled ? (
          <span className="explore-joined">Joined ✓</span>
        ) : (
          <div>
            <button type="button" disabled={busy} className="pill explore-action"
              onClick={() => { setBusy(true); setJoinFailed(false); trpc.paths.enroll.mutate({ slug: p.slug }).then(() => {
                posthog?.capture("learning_path_joined", { source: "explore" });
                onDone();
                if (first) void navigate({ to: "/courses/$slug", params: { slug: first.slug } });
              }, () => setJoinFailed(true)).finally(() => setBusy(false)); }}>
              Join
            </button>
            {joinFailed && <p role="alert" className="explore-join-err">Couldn't join. Try again.</p>}
          </div>
        )}
      </div>
    </li>
  );
}

export default function Explore() {
  const { data: session } = authClient.useSession();
  const initial = session?.user.email?.charAt(0).toUpperCase() ?? "?";
  const [scope, setScope] = useState<(typeof tabs)[number][0]>("official");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, reload } = useApi(`paths:${scope}:${dq}`, () => trpc.paths.list.query({ scope, q: dq || undefined }));
  const [view, setView] = useState<"grid" | "list">("grid");
  const refreshAll = useCallback(() => reload(), [reload]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next = (i + step + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else if (!step) return;
    e.preventDefault();
    setScope(tabs[next][0]);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="lq lq-moon lq-explore">
      <header className="lq-topbar">
        <Link to="/" className="lq-logo">
          <Logo />
        </Link>
        <nav className="lq-topnav" aria-label="Main">
          <Link to="/" className="lq-topnav-link">Home</Link>
          <Link to="/explore" className="lq-topnav-link" aria-current="page">Explore</Link>
          <Link to="/account" className="lq-avatar" aria-label="Account settings">{initial}</Link>
        </nav>
      </header>

      <main className="lq-wrap">
        <div className="explore-page">
          <Breadcrumb className="explore-crumb">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to="/" />}>Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Explore</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <h1 className="sr-only">Explore</h1>
          <div className="explore-filters">
            <div role="tablist" aria-label="Path source" className="explore-tabs">
              {tabs.map(([v, label], i) => (
                <button key={v} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab"
                  id={`tab-${v}`} aria-selected={scope === v} aria-controls="explore-results"
                  tabIndex={scope === v ? 0 : -1} onKeyDown={(e) => onTabKey(e, i)}
                  onClick={() => setScope(v)} className="explore-tab">{label}</button>
              ))}
            </div>
            <div className="explore-search-wrap">
              <label htmlFor="q" className="sr-only">Search paths</label>
              <Input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search paths" />
            </div>
          </div>
          {data && data.length > 0 && (
            <div className="explore-bar">
              <div role="group" aria-label="Layout" className="explore-view">
                <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                  <LayoutGrid size={18} aria-hidden="true" />
                </button>
                <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}>
                  <List size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          <div id="explore-results" role="tabpanel" tabIndex={0} aria-labelledby={`tab-${scope}`} className="explore-results">
            {error ? (
              <div className="explore-empty"><p>Couldn't load paths.</p></div>
            ) : !data ? <Spinner /> : data.length === 0 ? (
              <div className="explore-empty"><p>{scope === "mine" ? "You haven't joined or made any paths yet." : "Nothing here yet."}</p></div>
            ) : (
              <ul className="explore-list" data-view={view}>
                {data.map((p) => <Row key={p.slug} p={p} onDone={refreshAll} scope={scope} />)}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
