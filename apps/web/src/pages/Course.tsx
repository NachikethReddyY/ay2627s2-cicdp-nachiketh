import { Link, useParams } from "@tanstack/react-router";
import { useApi, type CourseData } from "../lib/api";
import { isNotFound, trpc } from "../lib/trpc";
import TopNav from "../components/TopNav";
import { Page, PipEmpty, Spinner } from "../components/Bits";

const offsets = ["ml-0", "ml-10 sm:ml-16", "ml-16 sm:ml-28", "ml-10 sm:ml-16"];

export default function Course() {
  const { slug } = useParams({ from: "/courses/$slug" });
  const { data, error } = useApi(`course:${slug}`, () => trpc.courses.get.query({ slug }));

  let body;
  if (error) {
    body = (
      <PipEmpty img="pip-oops">
        {isNotFound(error) ? "We couldn't find that course." : "Couldn't load this course."}{" "}
        <Link to="/explore" className="underline">Explore paths</Link>
      </PipEmpty>
    );
  } else if (!data) {
    body = <Spinner />;
  } else {
    const done = (l: CourseData["lessons"][number]) => l.total > 0 && l.done >= l.total;
    const current = data.lessons.find((l) => !done(l));
    const levels = [...new Set(data.lessons.map((l) => l.level))].sort((a, b) => a - b);
    let n = 0;
    body = (
      <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
        <section className="chunk h-fit bg-sun p-5">
          <h1 className="font-display text-4xl font-black">{data.title}</h1>
          <p className="mt-2 font-semibold">{data.description}</p>
          <p className="mt-3 text-sm font-extrabold">{data.lessons.length} {data.lessons.length === 1 ? "lesson" : "lessons"}</p>
        </section>
        <div className="space-y-8 pb-32">
          {levels.map((lv) => (
            <section key={lv} aria-labelledby={`lv${lv}`}>
              <h2 id={`lv${lv}`} className="pill mb-4 inline-block bg-lilac px-4 py-1">Level {lv}</h2>
              <ol className="space-y-5">
                {data.lessons.filter((l) => l.level === lv).map((l) => {
                  const isDone = done(l);
                  const isCur = l === current;
                  const cls = `grid size-16 place-items-center rounded-full border-[3px] border-ink text-xl font-black shadow-[0_5px_0_var(--color-ink)] ${isDone ? "bg-green text-white" : isCur ? "bg-sun" : "bg-white opacity-50"}`;
                  const mark = isDone ? "✓" : isCur ? "★" : "🔒";
                  return (
                    <li key={l.slug} className={`flex items-center gap-3 ${offsets[n++ % 4]}`}>
                      {isDone || isCur ? (
                        <Link to="/play" search={{ lesson: l.slug }} aria-label={`${l.title}${isDone ? " (complete)" : ""}`} className={`${cls} ${isCur ? "ring" : ""} focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-blue`}>{mark}</Link>
                      ) : (
                        <span role="img" aria-label={`${l.title} (locked)`} className={cls}>{mark}</span>
                      )}
                      <span className="font-extrabold">{l.title}</span>
                      {isCur && <img src="/img/pip-cheer.png" alt="" className="float w-14" />}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        {current && (
          <div className="chunk fixed inset-x-4 bottom-4 z-20 mx-auto flex max-w-3xl items-center justify-between gap-3 bg-white p-3 sm:p-4">
            <p className="min-w-0 truncate font-extrabold">{current.title}</p>
            <Link to="/play" search={{ lesson: current.slug }} className="btn shrink-0 !px-6 !py-2">{current.done > 0 ? "Continue" : "Start"}</Link>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <TopNav />
      <Page>{body}</Page>
    </>
  );
}
