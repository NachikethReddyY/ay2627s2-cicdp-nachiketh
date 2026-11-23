import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useApi, type PathCardData } from "../lib/api";
import { trpc } from "../lib/trpc";
import { authClient } from "../lib/auth";
import { EmptyNote, Spinner } from "../components/Bits";
import { Logo } from "./landing/Logo";
import Learning from "./home/Learning";
import Continue, { ResumeLink } from "./home/Continue";
import Generator from "./home/Generator";
import Mastery from "./home/Mastery";
import PathAction from "./home/PathAction";
import Sidebar from "./home/Sidebar";
import YourPath from "./home/YourPath";
import "./home.css";

const commCards = [
  { bg: "lq-bg-lilac", sticker: "HOT" },
  { bg: "lq-bg-pink", sticker: "NEW" },
  { bg: "lq-bg-mint", sticker: "" },
  { bg: "lq-bg-sun", sticker: "" },
];

export default function Home() {
  const { data, error, reload } = useApi("home", () => trpc.home.get.query());
  const { data: session } = authClient.useSession();
  const initial = session?.user.email?.charAt(0).toUpperCase() ?? "?";
  const stored = data?.stats.timezone;
  const activePath = data?.paths.find((path) => path.slug === data.continue?.path.slug) ?? data?.paths[0];
  const pathDone = activePath?.courses.reduce((sum, course) => sum + course.lessonsDone, 0) ?? 0;
  const pathTotal = activePath?.courses.reduce((sum, course) => sum + course.lessonsTotal, 0) ?? 0;
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!stored || stored === tz) return;
    let mounted = true;
    trpc.me.update.mutate({ timezone: tz }).then(
      () => {
        if (mounted) reload();
      },
      () => {},
    );
    return () => { mounted = false; };
  }, [stored, reload]);

  return (
    <div className="lq lq-moon">
      <header className="lq-topbar">
        <Link to="/" className="lq-logo">
          <Logo />
        </Link>
        <nav className="lq-topnav" aria-label="Main">
          <Link to="/" className="lq-topnav-link" aria-current="page">Home</Link>
          <Link to="/explore" className="lq-topnav-link">Explore</Link>
          <Link to="/account" className="lq-avatar" aria-label="Account settings">{initial}</Link>
        </nav>
      </header>

      <main className="lq-wrap">
        <h1 className="sr">LearnSlop home</h1>
        <div className="lq-layout">
          <div className="lq-main">
            {error ? (
              <EmptyNote><span role="alert">Couldn't load your home.</span> <button type="button" className="lq-pill" onClick={reload}>Retry</button></EmptyNote>
            ) : !data ? <Spinner /> : (
              <>
                <section className="lq-card lq-mobile-progress" aria-label="Progress at a glance">
                  <dl>
                    <div><dt>Total XP</dt><dd>{data.stats.xp}</dd></div>
                    <div><dt>Streak</dt><dd>{data.stats.streak} {data.stats.streak === 1 ? "day" : "days"}</dd></div>
                    <div><dt>Path progress</dt><dd>{activePath ? `${pathDone} / ${pathTotal} lessons` : "No path yet"}</dd></div>
                  </dl>
                </section>
                {data.continue ? <Continue c={data.continue} resume={data.resume} /> : data.resume ? <ResumeLink resume={data.resume} /> : null}
                {data.paths.length === 0 && (
                  <section className="lq-card lq-home-empty" aria-labelledby="home-empty">
                    <div>
                      <h2 id="home-empty">Find your first path</h2>
                      <p className="lq-tagline">Browse paths and choose what you want to learn.</p>
                    </div>
                    <Link to="/explore" className="lq-btn lq-btn-ink">Explore paths</Link>
                  </section>
                )}
              </>
            )}
            {data && <Learning items={data.learning} />}
            {data && <Mastery items={data.mastery} />}
            <Generator />

            {data && (
              <>
                {!data.continue && data.paths.length === 0 && data.official.length > 0 && (
                  <section aria-labelledby="start" className="lq-rise d2 lq-start-section">
                    <div className="lq-sec-head">
                      <h2 id="start">Start a path</h2>
                    </div>
                    <ul style={{ display: "flex", flexDirection: "column", gap: 18, listStyle: "none", margin: 0, padding: 0 }}>
                      {data.official.map((p, i) => (
                        <li key={p.slug} className={`lq-card ${i === 0 ? "lq-bg-sun" : ""}`} style={{ padding: 22, borderRadius: 20, display: "flex", alignItems: "center", gap: 16 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ fontSize: 22 }}>{p.title}</h3>
                            <p className="lq-tagline">{p.tagline}</p>
                            <p style={{ font: "500 12px var(--mono)", color: "var(--mu)", marginTop: 6 }}>{p.courseCount} {p.courseCount === 1 ? "course" : "courses"}</p>
                          </div>
                          <PathAction p={p} onDone={reload} label="Start" />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {data.paths.length > 0 && (
                  <section aria-labelledby="mine" className="lq-rise d3">
                    <div className="lq-sec-head">
                      <h2 id="mine">Your paths</h2>
                      <span className="lq-sticker lq-bg-mint">{data.paths.length} ACTIVE</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                      {data.paths.map((p, i) => <YourPath key={p.slug} p={p} index={i} />)}
                    </div>
                  </section>
                )}

                {data.community.length > 0 && (
                  <section aria-labelledby="comm-h" className="lq-rise d4">
                    <div className="lq-sec-head">
                      <h2 id="comm-h">Community</h2>
                      <span className="lq-sticker lq-bg-lilac">SHARED</span>
                      <Link to="/explore" className="lq-see-all">See all →</Link>
                    </div>
                    {data.community.length === 0 ? <EmptyNote>No community paths yet. Be the first to share one.</EmptyNote> : (
                      <ul className="lq-comm">
                        {data.community.slice(0, 4).map((p: PathCardData, i) => (
                          <li key={p.slug}>
                            <article className={`lq-card lq-cc lq-lift ${commCards[i % 4].bg}`}>
                              {commCards[i % 4].sticker && <span className="lq-sticker lq-cc-tag">{commCards[i % 4].sticker}</span>}
                              <h3>{p.title}</h3>
                              <p className="by">{p.learners} {p.learners === 1 ? "learner" : "learners"}</p>
                              <p className="meta">{p.courseCount} {p.courseCount === 1 ? "course" : "courses"}</p>
                              <div style={{ marginTop: "auto" }}><PathAction p={p} onDone={reload} label="Join" /></div>
                            </article>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </>
            )}
          </div>

          {data && <Sidebar stats={data.stats} leaderboard={data.leaderboard} />}
        </div>
      </main>
    </div>
  );
}
