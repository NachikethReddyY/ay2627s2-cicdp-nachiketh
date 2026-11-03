import { useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useApi, type CourseData } from "../lib/api";
import { authClient } from "../lib/auth";
import { isNotFound, trpc } from "../lib/trpc";
import { PipEmpty, Spinner } from "../components/Bits";
import LessonNode from "./course/LessonNode";
import PathTrack from "./course/PathTrack";
import "./course/course.css";

const wave = [0, 1, 0, -1];
const ROW = 112;
const seg = "rounded-full px-3 py-1.5 text-sm text-zinc-400 hover:text-white";

function useWide() {
  const q = "(min-width: 640px)";
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setWide(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return wide;
}

export default function Course() {
  const { slug } = useParams({ from: "/courses/$slug" });
  const { data, error } = useApi(`course:${slug}`, () => trpc.courses.get.query({ slug }));
  const { data: session } = authClient.useSession();
  const wide = useWide();
  const [open, setOpen] = useState<string | null>(null);
  const [syl, setSyl] = useState(false);

  let body;
  if (error) {
    body = (
      <div className="text-ink">
        <PipEmpty img="pip-oops">
          {isNotFound(error) ? "We couldn't find that course." : "Couldn't load this course."}{" "}
          <Link to="/explore" className="underline">Explore paths</Link>
        </PipEmpty>
      </div>
    );
  } else if (!data) {
    body = <Spinner />;
  } else {
    const done = (l: CourseData["lessons"][number]) => l.total > 0 && l.done >= l.total;
    const current = data.lessons.find((l) => !done(l));
    const levels = [...new Set(data.lessons.map((l) => l.level))].sort((a, b) => a - b);
    // progress bar follows the current lesson's level, or the last level once everything is done
    const lvNow = current?.level ?? levels[levels.length - 1];
    const inLv = data.lessons.filter((l) => l.level === lvNow);
    const doneInLv = inLv.filter(done).length;
    const pct = inLv.length ? Math.round((doneInLv / inLv.length) * 100) : 0;
    const amp = wide ? 72 : 40;
    let n = 0;
    body = (
      <div className="mx-auto max-w-xl">
        <section className="z-20 rounded-2xl border border-white/8 bg-[#131720]/90 p-5 backdrop-blur-md sm:sticky sm:top-20">
          <p className="mono text-[11px] tracking-widest text-amber-500">COURSE // {data.lessons.length} {data.lessons.length === 1 ? "LESSON" : "LESSONS"}</p>
          <h1 className="serif mt-1 text-4xl leading-tight font-medium text-white">{data.title}</h1>
          <p className="mt-2 text-zinc-300">{data.description}</p>
          <p className="mt-2 text-sm text-zinc-500">Each part is written when you open it, so no AI is wasted.</p>
          {lvNow !== undefined && (
            <div className="mt-4">
              <p className="mono mb-2 text-xs text-zinc-400">{doneInLv} of {inLv.length} {inLv.length === 1 ? "lesson" : "lessons"} done in Level {lvNow}</p>
              <div className="h-2 rounded-full bg-white/5" role="progressbar" aria-label={`Level ${lvNow} progress`} aria-valuemin={0} aria-valuemax={inLv.length} aria-valuenow={doneInLv}>
                <div className="h-full rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          <button type="button" aria-expanded={syl} aria-controls="syllabus" onClick={() => setSyl(!syl)} className="mono mt-4 flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300">
            {syl ? "HIDE" : "SHOW"} SYLLABUS <ChevronDown size={14} className={syl ? "rotate-180" : ""} aria-hidden />
          </button>
          {syl && (
            <ol id="syllabus" className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm">
              {data.lessons.map((l) => (
                <li key={l.slug} className={`flex gap-2 ${done(l) ? "text-emerald-400" : l === current ? "text-sky-400" : "text-zinc-500"}`}>
                  <span className="mono w-8 shrink-0 text-xs leading-5">L{String(l.level).padStart(2, "0")}</span>
                  {l.title}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* flex-col-reverse: the first lesson sits at the bottom and the path climbs up, while DOM/tab order stays first-to-last */}
        <div className="mt-10 flex flex-col-reverse gap-6 pb-44">
          {levels.map((lv) => {
            const ls = data.lessons.filter((l) => l.level === lv);
            const xs = ls.map(() => amp * wave[n++ % 4]);
            const lit = ls.filter((l) => done(l) || l === current).length;
            return (
              <section key={lv} aria-labelledby={`lv${lv}`} className="flex flex-col-reverse gap-4">
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-500/40" />
                  <h2 id={`lv${lv}`} className="mono max-w-[75%] truncate rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] tracking-wider text-amber-400">
                    LEVEL {String(lv).padStart(2, "0")} // {ls[0].title.toUpperCase()}
                  </h2>
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-500/40" />
                </div>
                <div className="relative">
                  <PathTrack xs={xs} lit={lit} row={ROW} />
                  <ol className="flex flex-col-reverse">
                    {ls.map((l, i) => {
                      const state = done(l) ? "done" : l === current ? "cur" : "locked";
                      const cta = state === "done" ? "Review" : l.done > 0 ? "Continue" : "Start";
                      return <LessonNode key={l.slug} l={l} slug={slug} state={state} x={xs[i]} cta={cta} open={open === l.slug} setOpen={setOpen} />;
                    })}
                  </ol>
                </div>
              </section>
            );
          })}
        </div>

        {current && (
          <div className="fixed inset-x-4 bottom-6 z-20 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#131720]/90 p-4 shadow-2xl backdrop-blur-xl">
            <div className="min-w-0">
              <p className="mono text-[11px] tracking-wider text-sky-400">LEVEL {current.level} • LESSON {data.lessons.filter((l) => l.level === current.level).indexOf(current) + 1}</p>
              <p className="truncate font-bold text-white">{current.title}</p>
            </div>
            <Link to="/play" search={{ lesson: current.slug, course: slug }} className="shrink-0 rounded-xl border-b-4 border-emerald-700 bg-emerald-500 px-6 py-2.5 font-semibold text-slate-950 hover:bg-emerald-400 active:translate-y-1">
              {current.done > 0 ? "Continue" : "Start"}
            </Link>
          </div>
        )}
      </div>
    );
  }

  const who = session?.user.name || session?.user.email;
  return (
    <div className="course">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#0B0D11]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" className="serif text-2xl font-semibold text-white">
            Learn<span className="text-sky-400">Quest</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 rounded-full border border-white/8 bg-[#131720] p-1">
            <Link to="/" className={seg}>Home</Link>
            <Link to="/explore" className={seg}>Explore</Link>
            {who && <span role="img" aria-label={`Signed in as ${who}`} className="grid size-8 place-items-center rounded-full bg-sky-500/20 text-sm font-semibold text-sky-300">{who[0].toUpperCase()}</span>}
          </nav>
        </div>
      </header>
      <main className="px-4 pt-6 sm:px-6">{body}</main>
    </div>
  );
}
