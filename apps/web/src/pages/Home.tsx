import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useApi, type HomeData, type PathCardData } from "../lib/api";
import { trpc, trpcCode } from "../lib/trpc";
import { PipEmpty, Spinner } from "../components/Bits";
import "./home.css";

const chips = ["Python basics", "React hooks", "SQL joins", "Git"];
const LEAGUE_XP = 500;

const aiErrors: Record<string, string> = {
  PRECONDITION_FAILED: "Pip's AI helper isn't switched on here yet.",
  TOO_MANY_REQUESTS: "You've sketched 5 paths today. Pip needs a nap, try again tomorrow!",
  BAD_REQUEST: "Pip only draws coding paths. Try a language, a tool or a project idea!",
};
const genericError = "Oops, Pip dropped the pencil. We couldn't generate that path. Check your connection and try again.";

// Mascot and icon art, copied from the design.
function Flame({ w, h, cls = "", fill = "#FF6A1F", inner = "#FFD23F", stroke = 2.5 }: { w: number; h: number; cls?: string; fill?: string; inner?: string; stroke?: number }) {
  return (
    <svg className={cls} width={w} height={h} viewBox="0 0 32 40" aria-hidden="true">
      <path d="M16 2c1 8 11 12 11 23a11 11 0 0 1-22 0c0-6 3-10 6-13 0 4 2 7 5 7-2-6-1-12 0-17z" fill={fill} stroke="#15121F" strokeWidth={stroke} strokeLinejoin="round" />
      <path d="M16 21c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-6 4-7 0 2 1 3 2 3z" fill={inner} />
    </svg>
  );
}

function Bolt({ w, h }: { w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 28" aria-hidden="true">
      <path d="M14 1 3 16h8l-2 11 12-16h-8z" fill="#FFD23F" stroke="#15121F" strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}

// Pip, the real mascot art from public/img. The pose tracks the generator state.
function Pip({ src, size }: { src: string; size: number }) {
  return <img className="lq-pip" src={src} width={size} height={size} alt="" aria-hidden="true" style={{ objectFit: "contain" }} />;
}

function Arrow() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Generator() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const navigate = useNavigate();

  const run = (prompt: string) => {
    setBusy(true);
    setErr(null);
    trpc.paths.generate.mutate({ prompt }).then(
      (r) => navigate({ to: "/courses/$slug", params: { slug: r.firstCourseSlug } }),
      (e) => {
        setErr(aiErrors[trpcCode(e) ?? ""] ?? genericError);
        setBusy(false);
      },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!q.trim()) {
      setEmpty(true);
      return;
    }
    run(q.trim());
  };

  const pose = <Pip src={busy ? "/img/pip-think.png" : err || empty ? "/img/pip-oops.png" : "/img/pip-wave.png"} size={220} />;

  return (
    <section className="lq-card lq-gen lq-bg-blue lq-rise d1" aria-labelledby="gen-h">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 id="gen-h" style={{ fontSize: 22, letterSpacing: ".06em" }}>Learn anything</h2>
        <span className="lq-sticker lq-bg-sun">AI</span>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="gen-q">What do you want to learn to code?</label>
        <div className="lq-gen-row">
          <input
            id="gen-q" type="text" autoComplete="off" value={q} disabled={busy} aria-describedby="gen-status"
            onChange={(e) => {
              setQ(e.target.value);
              setEmpty(false);
            }}
          />
          <button className="lq-btn lq-btn-sun" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <svg className="lq-spin" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="#15121f" strokeWidth={3.5} strokeLinecap="round" /></svg>}
            Generate
          </button>
        </div>
      </form>
      <ul className="lq-chips" aria-label="Quick picks">
        {chips.map((c, i) => (
          <li key={c}>
            <button className="lq-chip" type="button" onClick={() => { setQ(c); setEmpty(false); }}>
              {c}
              {i === 0 && <span className="lq-sticker lq-bg-pink" style={{ fontSize: 11, padding: "4px 6px", marginLeft: 2 }}>HOT</span>}
            </button>
          </li>
        ))}
      </ul>
      <div id="gen-status" className="lq-status" aria-live="polite">
        {busy && (
          <p className="lq-msg load">
            <svg className="lq-sketch" width="64" height="28" viewBox="0 0 64 28" aria-hidden="true"><path d="M3 22c8-14 14-14 18-4s10 8 14-2 12-10 26 2" fill="none" stroke="#2257FF" strokeWidth={3.5} strokeLinecap="round" /></svg>
            Pip is sketching your path<span className="lq-blink" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
          </p>
        )}
        {err && (
          <div className="lq-msg err lq-shake" role="alert">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#FF7AB6" stroke="#15121F" strokeWidth={2.5} /><path d="M12 7v6M12 16.5v.5" stroke="#15121F" strokeWidth={3} strokeLinecap="round" /></svg>
            <span style={{ flex: "1 1 260px" }}>{err}</span>
            <button className="lq-btn lq-btn-ink" type="button" onClick={() => run(q.trim())} style={{ minHeight: 44, fontSize: 17, padding: "0 16px", boxShadow: "3px 3px 0 #15121f" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></svg>
              Retry
            </button>
          </div>
        )}
        {empty && <p className="lq-msg err lq-shake" role="alert">Type what you want to learn first, or tap a quick pick.</p>}
      </div>
      <div className="lq-gen-pip" aria-hidden="true">{pose}</div>
    </section>
  );
}

function PathAction({ p, onDone, label }: { p: PathCardData; onDone: () => void; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <>
      <button
        type="button" disabled={busy} aria-label={`${label} ${p.title}`} className="lq-btn lq-btn-surface"
        style={{ minHeight: 44, fontSize: 17, padding: "0 18px" }}
        onClick={() => {
          setBusy(true);
          setErr(false);
          trpc.paths.enroll.mutate({ slug: p.slug }).then(onDone, () => setErr(true)).finally(() => setBusy(false));
        }}
      >
        {label}
      </button>
      {err && <p role="alert" style={{ marginTop: 4, fontWeight: 700, fontSize: 14 }}>Couldn't join. Try again.</p>}
    </>
  );
}

function Continue({ c }: { c: NonNullable<HomeData["continue"]> }) {
  return (
    <section className="lq-card lq-hero lq-bg-pink lq-rise d2" aria-labelledby="hero-h" style={{ marginTop: 8 }}>
      <div className="lq-peek-top" style={{ right: 64 }} aria-hidden="true"><Pip src="/img/pip-cheer.png" size={104} /></div>
      <div>
        <div className="lq-eyebrow">
          <span className="lq-tag">{c.path.title}</span>
          <span style={{ font: "400 18px var(--font-display)", letterSpacing: ".04em" }}>Course {c.course.index + 1} of {c.course.count}</span>
        </div>
        <h2 id="hero-h" style={{ fontSize: 62, lineHeight: ".95" }}>{c.course.title}</h2>
        <p style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, font: "700 19px var(--font-body)" }}>
          <span className="lq-lvl"><span className="sr">Level </span>LV {c.lesson.level}</span>
          {c.lesson.title}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, maxWidth: 460 }}>
          <div
            className="lq-meter lg f-sun" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={c.lesson.total}
            aria-valuenow={c.lesson.done} style={{ flex: "1 1 auto" }}
          >
            <span style={{ width: `${pct(c.lesson.done, c.lesson.total)}%` }} />
          </div>
          <span style={{ font: "400 20px var(--font-display)", whiteSpace: "nowrap" }}>{c.lesson.done} / {c.lesson.total}</span>
        </div>
        <div style={{ position: "relative", display: "inline-block", marginTop: 26 }}>
          <Link to="/play" search={{ lesson: c.lesson.slug }} className="lq-btn lq-btn-ink lq-btn-xl">Continue<Arrow /></Link>
        </div>
      </div>
      <div className="lq-code lq-tr2" aria-hidden="true">
        <span className="lq-sticker lq-bg-sun" style={{ position: "absolute", top: -16, left: 18 }}>PREDICT</span>
        <div><span className="k">for</span> i <span className="k">in</span> <span className="f">range</span>(<span className="n">3</span>):</div>
        <div>&#160;&#160;<span className="k">for</span> j <span className="k">in</span> <span className="f">range</span>(i):</div>
        <div>&#160;&#160;&#160;&#160;<span className="f">print</span>(i, j)</div>
        <div className="c"># what prints?</div>
        <div className="q">&gt; ? ? ?</div>
      </div>
    </section>
  );
}

function pct(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function YourPath({ p, index }: { p: HomeData["paths"][number]; index: number }) {
  const nowIndex = p.courses.findIndex((c) => !(c.lessonsTotal > 0 && c.lessonsDone >= c.lessonsTotal));
  return (
    <article className="lq-card lq-path">
      <div className="lq-path-head">
        <span className={`lq-path-badge ${index % 2 ? "lq-bg-lilac" : "lq-bg-sun"}`} aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" fill="none" stroke="#15121f" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <h3>{p.title}</h3>
          <p className="lq-tagline">{p.tagline}</p>
        </div>
      </div>
      <div className="lq-track" role="region" aria-label={`${p.title} courses`} tabIndex={0}>
        <ol className="lq-track-inner">
          {p.courses.map((c, i) => {
            const done = c.lessonsTotal > 0 && c.lessonsDone >= c.lessonsTotal;
            const now = i === nowIndex;
            const state = done ? "done" : now ? "now" : "";
            const fill = done ? "f-blue" : now ? "f-pink" : "f-lilac";
            const w = pct(c.lessonsDone, c.lessonsTotal);
            return (
              <li key={c.slug}>
                <Link to="/courses/$slug" params={{ slug: c.slug }} className={`lq-tile lq-lift ${state}`}>
                  {done && (
                    <>
                      <span className="lq-stampbox lq-stamp" aria-hidden="true"><Check size={22} /></span>
                      <svg className="lq-sparkle lq-spark" style={{ top: -12, left: 14 }} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1c1 6 5 10 11 11-6 1-10 5-11 11-1-6-5-10-11-11 6-1 10-5 11-11z" fill="#FFD23F" stroke="#15121F" strokeWidth={2} /></svg>
                    </>
                  )}
                  {now && <span className="lq-sticker lq-bg-pink" style={{ position: "absolute", top: -14, right: 12 }}>NOW</span>}
                  <span className="num">COURSE {i + 1}</span>
                  <h4>{c.title}</h4>
                  {done && <span className="sr">Completed. </span>}
                  <div className={`lq-meter sm ${fill}`} role="progressbar" aria-label={`${c.title} progress`} aria-valuemin={0} aria-valuemax={c.lessonsTotal} aria-valuenow={c.lessonsDone}>
                    <span className={w === 0 ? "zero" : ""} style={{ width: `${w}%` }} />
                  </div>
                  <span className="xy">{c.lessonsDone} / {c.lessonsTotal}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </article>
  );
}

// Tilts repeat across the four community cards, as in the design.
const commCards = [
  { bg: "lq-bg-lilac lq-tl2", sticker: "HOT" },
  { bg: "lq-bg-pink lq-tr", sticker: "NEW" },
  { bg: "lq-bg-mint lq-tl", sticker: "" },
  { bg: "lq-bg-sun lq-tr2", sticker: "" },
];

export default function Home() {
  const { data, error, reload } = useApi("home", () => trpc.home.get.query());
  useEffect(() => {
    // Stats are counted in the stored timezone, so refetch once it is saved.
    trpc.me.update.mutate({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(reload, () => {});
  }, [reload]);

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
        <h1 className="sr">LearnQuest home</h1>
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

          {stats && (
            <aside className="lq-side" aria-label="Your progress">
              <section className="lq-card lq-stat lq-bg-sun lq-tr lq-rise d2" aria-labelledby="streak-h">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 id="streak-h">Streak</h2>
                  <span className="lq-sticker lq-bg-surface lq-r">{stats.streak > 0 ? "ON FIRE" : "DAY 1 AWAITS"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 10 }}>
                  <Flame w={64} h={80} cls="lq-flame" />
                  <p><span className="lq-score">{stats.streak}</span> <span style={{ font: "400 24px var(--font-display)" }}>days</span></p>
                </div>
                <ul className="lq-days" aria-label="This week">
                  {stats.week.map((d, i) => {
                    const today = i === stats.week.length - 1;
                    const on = d.solved >= 3;
                    const label = new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { weekday: "long" });
                    return (
                      <li key={d.day} className={`lq-day${on ? " on" : ""}${today ? " today" : ""}`}>
                        <span className="sr">{today ? `${label}, today` : label}: {d.solved} solved</span>
                        <span className="lq-dot" aria-hidden="true">{on ? <Check size={18} /> : `${d.solved}/3`}</span>
                        <span aria-hidden="true">{label[0]}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="lq-rule"><Flame w={16} h={20} stroke={3} />Solve 3 problems to keep your streak.</p>
              </section>

              <section className="lq-card lq-stat lq-bg-surface lq-tl lq-rise d3" aria-labelledby="goal-h">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 id="goal-h">Daily goal</h2>
                  <Bolt w={26} h={30} />
                </div>
                <p style={{ marginTop: 12 }}>
                  <span style={{ font: "400 52px/1 var(--font-display)" }}>{stats.todayXp}</span>
                  <span style={{ font: "400 28px var(--font-display)" }}> / {stats.dailyGoalXp}</span>{" "}
                  <span style={{ font: "700 16px var(--font-body)" }}>XP today</span>
                </p>
                <div
                  className="lq-meter lg f-mint" role="progressbar" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={stats.dailyGoalXp}
                  aria-valuenow={stats.todayXp} style={{ marginTop: 14 }}
                >
                  <span style={{ width: `${pct(stats.todayXp, stats.dailyGoalXp)}%` }} />
                </div>
              </section>

              <section className="lq-card lq-stat lq-league lq-tr lq-rise d4" aria-labelledby="league-h">
                <span className="lq-sticker lq-bg-surface" style={{ position: "absolute", top: -14, right: 18 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth={2.5} /><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth={2.5} /></svg>
                  LOCKED
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <svg className="lq-trophy-lock" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
                    <path d="M18 8h28v14a14 14 0 0 1-28 0z" fill="#B9A6FF" stroke="#15121F" strokeWidth={3} strokeLinejoin="round" />
                    <path d="M18 14H9a10 10 0 0 0 10 12M46 14h9a10 10 0 0 1-10 12" fill="none" stroke="#15121F" strokeWidth={3} />
                    <path d="M28 36h8v10h-8zM20 46h24v9H20z" fill="#B9A6FF" stroke="#15121F" strokeWidth={3} strokeLinejoin="round" />
                    <text x="32" y="27" textAnchor="middle" fontFamily="Lilita One, sans-serif" fontSize={16} fill="#15121F">?</text>
                  </svg>
                  <div>
                    <h2 id="league-h">Leagues</h2>
                    <p style={{ font: "700 15px var(--font-body)", marginTop: 4 }}>Unlocks at {LEAGUE_XP} XP</p>
                  </div>
                </div>
                <div
                  className="lq-meter f-lilac" role="progressbar" aria-label="Leagues unlock progress" aria-valuemin={0}
                  aria-valuemax={LEAGUE_XP} aria-valuenow={Math.min(stats.xp, LEAGUE_XP)} style={{ marginTop: 16 }}
                >
                  <span style={{ width: `${pct(Math.min(stats.xp, LEAGUE_XP), LEAGUE_XP)}%` }} />
                </div>
                <p style={{ display: "flex", justifyContent: "space-between", marginTop: 8, font: "700 14px var(--font-body)" }}>
                  <span>{stats.xp} / {LEAGUE_XP} XP</span>
                  <span>{Math.max(LEAGUE_XP - stats.xp, 0)} XP to go</span>
                </p>
              </section>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
