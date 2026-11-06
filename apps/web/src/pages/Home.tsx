import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useApi, type PathCardData } from "../lib/api";
import { trpc } from "../lib/trpc";
import { PipEmpty, Spinner } from "../components/Bits";
import { Bolt, Flame } from "./home/art";
import Continue from "./home/Continue";
import Generator from "./home/Generator";
import PathAction from "./home/PathAction";
import Sidebar from "./home/Sidebar";
import YourPath from "./home/YourPath";
import "./home.css";


// Tilts repeat across the four community cards, as in the design.
const commCards = [
  { bg: "lq-bg-lilac lq-tl2", sticker: "HOT" },
  { bg: "lq-bg-pink lq-tr", sticker: "NEW" },
  { bg: "lq-bg-mint lq-tl", sticker: "" },
  { bg: "lq-bg-sun lq-tr2", sticker: "" },
];

export default function Home() {
  const { data, error, reload } = useApi("home", () => trpc.home.get.query());
  const stored = data?.stats.timezone;
  useEffect(() => {
    // Stats are counted in the stored timezone, which home.get returns. Send this browser's zone only when it
    // differs (another device may have changed it), then refetch once it is saved, unless the page is already gone.
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

  const stats = data?.stats;

  return (
    <div className="lq">
      <header className="lq-topbar">
        <Link to="/" className="lq-logo">
          <svg width="42" height="42" viewBox="0 0 40 40" aria-hidden="true">
            <rect x="2" y="2" width="36" height="36" rx="10" fill="#2257FF" stroke="#15121F" strokeWidth={3} />
            <path d="M15 13l-6 7 6 7M25 13l6 7-6 7" fill="none" stroke="#FFD23F" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="lq-logo-word">Learn<span className="lq-logo-q">Quest</span></span>
        </Link>
        {stats && (
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <p className="lq-pill"><Flame w={22} h={28} cls="lq-flame" /><span className="lq-pill-n">{stats.streak}</span><span className="sr">day streak</span></p>
            <p className="lq-pill"><Bolt w={20} h={24} /><span className="lq-pill-n">{stats.xp}</span><span>XP</span></p>
          </div>
        )}
      </header>

      <main className="lq-wrap">
        <h1 className="sr">LearnSlop home</h1>
        <div className="lq-layout">
          <div className="lq-main">
            <Generator />

            {error || !data ? (
              error ? (
                <PipEmpty img="pip-oops">Couldn't load your home. <button type="button" className="lq-pill" onClick={reload}>Retry</button></PipEmpty>
              ) : <Spinner />
            ) : (
              <>
                {data.continue ? (
                  <Continue c={data.continue} />
                ) : data.paths.length === 0 ? (
                  <section aria-labelledby="start" className="lq-rise d2">
                    <div className="lq-sec-head">
                      <h2 id="start">Start a path</h2>
                      <span className="lq-sticker lq-r lq-bg-sun">OFFICIAL</span>
                    </div>
                    {data.official.length === 0 ? <PipEmpty>No paths yet. Check back soon.</PipEmpty> : (
                      <ul style={{ display: "flex", flexDirection: "column", gap: 18, listStyle: "none", margin: 0, padding: 0 }}>
                        {data.official.map((p, i) => (
                          <li key={p.slug} className={`lq-card ${i === 0 ? "lq-bg-sun lq-tl" : i % 2 ? "lq-tl2" : "lq-tr"}`} style={{ padding: 22, borderRadius: 24, display: "flex", alignItems: "center", gap: 16 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h3 style={{ fontSize: 28 }}>{p.title}</h3>
                              <p className="lq-tagline" style={{ color: "inherit" }}>{p.tagline}</p>
                              <p style={{ font: "700 13px var(--font-body)", marginTop: 6 }}>{p.courseCount} {p.courseCount === 1 ? "course" : "courses"}</p>
                            </div>
                            <PathAction p={p} onDone={reload} label="Start" />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}

                {data.paths.length > 0 && (
                  <section aria-labelledby="mine" className="lq-rise d3">
                    <div className="lq-sec-head">
                      <h2 id="mine">Your paths</h2>
                      <span className="lq-sticker lq-r lq-bg-mint">{data.paths.length} ACTIVE</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
                      {data.paths.map((p, i) => <YourPath key={p.slug} p={p} index={i} />)}
                    </div>
                  </section>
                )}

                <section aria-labelledby="comm-h" className="lq-rise d4">
                  <div className="lq-sec-head">
                    <h2 id="comm-h">Community</h2>
                    <span className="lq-sticker lq-bg-lilac">SHARED</span>
                    <Link to="/explore" className="lq-see-all">See all →</Link>
                  </div>
                  {data.community.length === 0 ? <PipEmpty img="pip-sheet">No community paths yet. Be the first to share one.</PipEmpty> : (
                    <ul className="lq-comm">
                      {data.community.slice(0, 4).map((p: PathCardData, i) => (
                        <li key={p.slug}>
                          <article className={`lq-card lq-cc lq-lift ${commCards[i % 4].bg}`}>
                            {commCards[i % 4].sticker && <span className="lq-sticker lq-bg-surface" style={{ position: "absolute", top: -14, right: 14 }}>{commCards[i % 4].sticker}</span>}
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
              </>
            )}
          </div>

          {stats && <Sidebar stats={stats} />}
        </div>
      </main>
    </div>
  );
}
