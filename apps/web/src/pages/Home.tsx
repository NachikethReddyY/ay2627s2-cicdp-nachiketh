import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useApi } from "../lib/api";
import { trpc } from "../lib/trpc";
import { authClient } from "../lib/auth";
import { EmptyNote, Spinner } from "../components/Bits";
import { Logo } from "./landing/Logo";
import Learning from "./home/Learning";
import Continue, { ResumeLink } from "./home/Continue";
import Generator from "./home/Generator";
import Leaderboard from "./home/Leaderboard";
import Mastery from "./home/Mastery";
import PathAction from "./home/PathAction";
import Progress from "./home/Progress";
import YourPath from "./home/YourPath";
import "./home.css";
import "./dashboard.css";

export default function Home() {
  const { data, error, reload } = useApi("home", () => trpc.home.get.query());
  const { data: session } = authClient.useSession();
  const initial = session?.user.email?.charAt(0).toUpperCase() ?? "?";
  const stored = data?.stats.timezone;
  const activePath = data?.paths.find((path) => path.slug === data.continue?.path.slug) ?? data?.paths[0];
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
    <div className="lq lq-dashboard">
      <header className="lq-dashboard-header">
        <div className="lq-topbar">
          <Link to="/" className="lq-logo">
            <Logo />
          </Link>
          <nav className="lq-topnav" aria-label="Main">
            <Link to="/" className="lq-topnav-link" aria-current="page">Home</Link>
            <Link to="/explore" className="lq-topnav-link">Explore</Link>
            <Link to="/account" className="lq-avatar" aria-label="Account settings">{initial}</Link>
          </nav>
        </div>
      </header>

      <main className="lq-wrap">
        <h1>Home</h1>
        <div className="lq-dashboard-flow">
          {error ? (
            <EmptyNote><span role="alert">Couldn't load your home.</span> <button type="button" className="lq-pill" onClick={reload}>Retry</button></EmptyNote>
          ) : !data ? <Spinner /> : (
            <>
              <div className="lq-dashboard-pair">
                {(data.continue || data.resume || data.paths.length === 0) && (
                  <div className="lq-dashboard-next">
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
                  </div>
                )}
                <Progress stats={data.stats} path={activePath} />
              </div>

              {!data.continue && data.paths.length === 0 && data.official.length > 0 && (
                <section aria-labelledby="start">
                  <div className="lq-sec-head"><h2 id="start">Start a path</h2></div>
                  <ul className="lq-dashboard-path-options">
                    {data.official.map((path) => (
                      <li key={path.slug} className="lq-card">
                        <div>
                          <h3>{path.title}</h3>
                          <p className="lq-tagline">{path.tagline}</p>
                          <p className="lq-dashboard-meta">{path.courseCount} {path.courseCount === 1 ? "course" : "courses"}</p>
                        </div>
                        <PathAction p={path} onDone={reload} label="Start" />
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.paths.length > 0 && (
                <section className="lq-card lq-dashboard-paths" aria-labelledby="mine">
                  <h2 id="mine">Your paths</h2>
                  {data.paths.map((path) => <YourPath key={path.slug} p={path} />)}
                </section>
              )}

              {(data.mastery.length > 0 || data.learning.length > 0) && (
                <div className="lq-dashboard-pair">
                  <Mastery items={data.mastery} />
                  <Learning items={data.learning} />
                </div>
              )}
            </>
          )}

          <div className="lq-dashboard-pair">
            <Generator />
            {data && <Leaderboard leaderboard={data.leaderboard} />}
          </div>

          {data && data.community.length > 0 && (
            <section aria-labelledby="comm-h">
              <div className="lq-sec-head">
                <h2 id="comm-h">Community</h2>
                <Link to="/explore" className="lq-see-all">See all →</Link>
              </div>
              <ul className="lq-comm">
                {data.community.slice(0, 4).map((path) => (
                  <li key={path.slug}>
                    <article className="lq-card lq-cc">
                      <h3>{path.title}</h3>
                      <p className="by">{path.learners} {path.learners === 1 ? "learner" : "learners"}</p>
                      <p className="meta">{path.courseCount} {path.courseCount === 1 ? "course" : "courses"}</p>
                      <div className="lq-dashboard-join"><PathAction p={path} onDone={reload} label="Join" /></div>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
