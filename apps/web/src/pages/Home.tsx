import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useApi, type HomeData, type PathCardData } from "../lib/api";
import { trpc, trpcCode } from "../lib/trpc";
import TopNav from "../components/TopNav";
import { AiBadge, Bar, Page, PipEmpty, Spinner } from "../components/Bits";

const chips = ["Python basics", "React hooks", "SQL joins", "Git"];
const LEAGUE_XP = 500;

const aiErrors: Record<string, string> = {
  PRECONDITION_FAILED: "Pip's AI helper isn't switched on here yet.",
  TOO_MANY_REQUESTS: "You've sketched 5 paths today. Pip needs a nap, try again tomorrow!",
  BAD_REQUEST: "Pip only draws coding paths. Try a language, a tool or a project idea!",
};

function LearnAnything() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const navigate = useNavigate();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || text.trim().length < 3) return;
    setBusy(true);
    setErr("");
    trpc.paths.generate.mutate({ prompt: text.trim() }).then(
      (r) => navigate({ to: "/courses/$slug", params: { slug: r.firstCourseSlug } }),
      (e) => {
        setErr(aiErrors[trpcCode(e) ?? ""] ?? "Pip dropped the pencil. Try again?");
        setBusy(false);
      },
    );
  };
  return (
    <form onSubmit={submit} className="chunk mt-2 flex flex-col gap-3 bg-lilac p-4 sm:flex-row sm:items-center sm:p-5">
      <img src={busy ? "/img/pip-think.png" : "/img/pip-wave.png"} alt="" className={`hidden w-20 shrink-0 sm:block ${busy ? "float" : ""}`} />
      <div className="min-w-0 flex-1 space-y-3">
        <label htmlFor="learn" className="block font-display text-2xl font-black">Learn anything</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="learn" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} disabled={busy}
            placeholder="What do you want to learn to code?"
            className="min-w-0 flex-1 rounded-xl border-[3px] border-ink bg-white px-4 py-2.5 font-semibold outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue"
          />
          <button type="submit" disabled={busy || text.trim().length < 3} className="btn disabled:opacity-50">{busy ? "Sketching…" : "Generate"}</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c} type="button" disabled={busy} onClick={() => setText(c)} className="pill bg-white px-3 py-1 text-sm">{c}</button>
          ))}
        </div>
        <div aria-live="polite" className="min-h-6 text-sm font-extrabold">
          {busy ? "Pip is sketching your path…" : err && <span role="alert">{err}</span>}
        </div>
      </div>
    </form>
  );
}

function Streak({ s }: { s: HomeData["stats"] }) {
  return (
    <section className="chunk bg-sun p-5" aria-label="Streak">
      <p className="font-display text-6xl font-black leading-none">🔥 {s.streak}</p>
      <p className="mt-1 font-extrabold">day streak</p>
      <p className="mt-2 text-sm font-bold">Solve 3 problems to keep your streak</p>
      <ul className="mt-4 flex justify-between gap-1">
        {s.week.map((d, i) => {
          const today = i === s.week.length - 1;
          const label = new Date(`${d.day}T00:00`).toLocaleDateString(undefined, { weekday: "long" });
          return (
            <li key={d.day} className="flex flex-col items-center gap-1 text-xs font-extrabold">
              <span
                role="img" aria-label={`${label}: ${d.solved >= 3 ? "streak kept" : `${d.solved} solved`}${today ? " (today)" : ""}`}
                className={`size-7 rounded-full border-[3px] border-ink ${d.solved >= 3 ? "bg-green" : "bg-white"} ${today ? "ring" : ""}`}
              />
              {label[0]}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Side({ s }: { s: HomeData["stats"] }) {
  return (
    <div className="space-y-6">
      <Streak s={s} />
      <section className="chunk bg-white p-5" aria-label="Daily goal">
        <h2 className="font-display text-xl font-black">Daily goal</h2>
        <div className="my-3"><Bar value={s.todayXp} total={s.dailyGoalXp} label="Daily goal XP" /></div>
        <p className="text-sm font-bold">{s.todayXp} / {s.dailyGoalXp} XP today</p>
      </section>
      <section className="chunk bg-paper p-5 opacity-80" aria-label="Leagues">
        <h2 className="font-display text-xl font-black">🔒 Leagues</h2>
        <p className="mb-3 text-sm font-bold">Unlocks at {LEAGUE_XP} XP</p>
        <Bar value={Math.min(s.xp, LEAGUE_XP)} total={LEAGUE_XP} label="XP toward leagues" />
        <p className="mt-2 text-sm font-bold">{s.xp} / {LEAGUE_XP} XP</p>
      </section>
    </div>
  );
}

function PathAction({ p, onDone, label }: { p: PathCardData; onDone: () => void; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <>
      <button
        type="button" disabled={busy} className="btn !px-5 !py-2 text-sm disabled:opacity-60"
        onClick={() => {
          setBusy(true);
          setErr(false);
          trpc.paths.enroll.mutate({ slug: p.slug }).then(onDone, () => setErr(true)).finally(() => setBusy(false));
        }}
      >
        {label}
      </button>
      {err && <p role="alert" className="mt-1 text-sm font-bold">Couldn't join. Try again.</p>}
    </>
  );
}

export function PathTile({ p, onDone, label = "Join" }: { p: PathCardData; onDone: () => void; label?: string }) {
  return (
    <li className="chunk flex flex-col gap-2 bg-white p-4">
      <h3 className="flex items-center gap-2 text-lg font-black">{p.title}{p.origin === "ai" && <AiBadge />}</h3>
      <p className="flex-1 text-sm font-semibold text-ink/70">{p.tagline}</p>
      <p className="text-xs font-extrabold">{p.courseCount} {p.courseCount === 1 ? "course" : "courses"} · {p.learners} {p.learners === 1 ? "learner" : "learners"}</p>
      <div><PathAction p={p} onDone={onDone} label={label} /></div>
    </li>
  );
}

function Continue({ c }: { c: NonNullable<HomeData["continue"]> }) {
  return (
    <section className="chunk bg-mint p-5 sm:p-6" aria-label="Continue learning">
      <p className="text-sm font-extrabold">{c.path.title}</p>
      <p className="mt-1 text-sm font-bold">Course {c.course.index + 1} of {c.course.count}</p>
      <h2 className="font-display text-3xl font-black">{c.course.title}</h2>
      <p className="mt-3 font-extrabold">{c.lesson.title} <span className="pill ml-1 bg-white px-2 py-0.5 text-xs">Level {c.lesson.level}</span></p>
      <div className="my-3 max-w-sm"><Bar value={c.lesson.done} total={c.lesson.total} label="Lesson progress" /></div>
      <p className="mb-4 text-sm font-bold">{c.lesson.done} / {c.lesson.total} done</p>
      <Link to="/play" search={{ lesson: c.lesson.slug }} className="btn ring text-lg">Continue</Link>
    </section>
  );
}

function YourPath({ p }: { p: HomeData["paths"][number] }) {
  return (
    <li className="chunk bg-white p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-display text-2xl font-black">{p.title}{p.origin === "ai" && <AiBadge />}</h3>
      <p className="text-sm font-semibold text-ink/70">{p.tagline}</p>
      <ol className="relative mt-4 flex gap-4 overflow-x-auto px-1 pb-3 pt-1">
        <span aria-hidden="true" className="absolute left-0 right-0 top-1/2 -z-0 h-1 -translate-y-1/2 bg-ink" />
        {p.courses.map((c) => {
          const done = c.lessonsTotal > 0 && c.lessonsDone >= c.lessonsTotal;
          return (
            <li key={c.slug} className="relative z-10 w-44 shrink-0">
              <Link to="/courses/$slug" params={{ slug: c.slug }} className={`chunk block p-3 !shadow-[4px_4px_0_var(--color-ink)] ${done ? "bg-mint" : "bg-paper"}`}>
                <span className="flex items-start justify-between gap-1 font-extrabold">{c.title}{done && <span aria-label="Complete">✓</span>}</span>
                <span className="mb-1 mt-2 block"><Bar value={c.lessonsDone} total={c.lessonsTotal} label={`${c.title} progress`} /></span>
                <span className="text-xs font-bold">{c.lessonsDone} / {c.lessonsTotal}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </li>
  );
}

export default function Home() {
  const { data, error, reload } = useApi("home", () => trpc.home.get.query());
  useEffect(() => {
    // Stats are counted in the stored timezone, so refetch once it is saved.
    trpc.me.update.mutate({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(reload, () => {});
  }, [reload]);

  return (
    <>
      <TopNav streak={data?.stats.streak} xp={data?.stats.xp} />
      <Page>
        <LearnAnything />
        {error ? (
          <div className="mt-8"><PipEmpty img="pip-oops">Couldn't load your home. <button type="button" className="pill bg-white px-3 py-1 text-sm" onClick={reload}>Retry</button></PipEmpty></div>
        ) : !data ? (
          <Spinner />
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[20rem_1fr]">
            <Side s={data.stats} />
            <div className="min-w-0 space-y-10">
              {data.continue ? (
                <Continue c={data.continue} />
              ) : data.paths.length === 0 ? (
                <section aria-labelledby="start">
                  <h2 id="start" className="mb-4 font-display text-3xl font-black">Start a path</h2>
                  {data.official.length === 0 ? <PipEmpty>No paths yet. Check back soon.</PipEmpty> : (
                    <ul className="grid gap-4 sm:grid-cols-2">{data.official.map((p) => <PathTile key={p.slug} p={p} onDone={reload} label="Start" />)}</ul>
                  )}
                </section>
              ) : null}

              {data.paths.length > 0 && (
                <section aria-labelledby="mine">
                  <h2 id="mine" className="mb-4 font-display text-3xl font-black">Your paths</h2>
                  <ul className="space-y-6">{data.paths.map((p) => <YourPath key={p.slug} p={p} />)}</ul>
                </section>
              )}

              <section aria-labelledby="comm">
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 id="comm" className="font-display text-3xl font-black">Community</h2>
                  <Link to="/explore" className="font-extrabold underline">See all →</Link>
                </div>
                {data.community.length === 0 ? <PipEmpty img="pip-sheet">No community paths yet. Be the first to share one.</PipEmpty> : (
                  <ul className="grid gap-4 sm:grid-cols-2">{data.community.slice(0, 4).map((p) => <PathTile key={p.slug} p={p} onDone={reload} />)}</ul>
                )}
              </section>
            </div>
          </div>
        )}
      </Page>
    </>
  );
}
