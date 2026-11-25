import { Link, useLocation, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Spinner } from "../components/Bits";
import { useApi } from "../lib/api";
import { isNotFound, trpc } from "../lib/trpc";
import "./home.css";
import "./roadmap.css";

const scrollToSection = (node: HTMLElement | null) => node?.scrollIntoView();

const kinds = {
  learn: "Learn",
  watch: "Watch",
  predict: "Predict",
  practice: "Practice",
  scrim: "Scrim",
  "game-practice": "Game",
};

export default function Roadmap() {
  const { slug } = useParams({ from: "/paths/$slug" });
  const hash = useLocation({ select: (location) => location.hash });
  const [retryFailed, setRetryFailed] = useState(false);
  const { data, error, reload, loading } = useApi(`path:${slug}`, () => trpc.paths.get.query({ slug }));

  const ready = !data?.build || data.build.state === "ready";
  const start = data?.sections.flatMap((section) => section.lessons
    .filter((lesson) => lesson.writeState === "ready" && lesson.missingPrerequisites.length === 0 && lesson.done < lesson.total)
    .map((lesson) => ({ course: section.slug, lesson: lesson.slug })))[0];

  const retry = async () => {
    setRetryFailed(false);
    try {
      await trpc.paths.retryBuild.mutate({ slug });
      reload();
    } catch {
      setRetryFailed(true);
    }
  };

  return (
    <div className="lq lq-moon">
      <main className="lq-roadmap">
        <nav aria-label="Main"><Link to="/">Home</Link> · <Link to="/explore">Explore</Link></nav>
        {error ? <p role="alert">{isNotFound(error) ? "We couldn't find that path." : "Couldn't load this roadmap."}</p>
          : !data ? <Spinner /> : <>
            <header>
              <h1>{data.title}</h1>
              <p className="lq-tagline">{data.tagline}</p>
            </header>
            {data.roadmap && (
              <div className="lq-card lq-roadmap-panel">
                <h2>Starting point</h2>
                <p>{data.roadmap.startingPoint}</p>
                <h2>Destination</h2>
                <p>{data.roadmap.destination}</p>
                <h2>What you’ll learn</h2>
                <ul>
                  {data.roadmap.topics.map((topic) => <li key={topic.title}><strong>{topic.title}</strong> · {topic.outcome}</li>)}
                </ul>
              </div>
            )}
            {ready && start && data.build && (
              <div><Link to="/lessons" search={{ ...start, path: slug }} state={{ lessonEntrySource: "course_cta" }} className="lq-btn lq-btn-blue">Start</Link></div>
            )}
            {data.build && !ready && (
              <div className="lq-card lq-roadmap-panel" role="status">
                <p>{data.build.state === "planning" ? "Planning your roadmap…"
                  : data.build.state === "refused" ? "This topic couldn’t be turned into a learning path. Go back to Home and try a different programming topic."
                  : data.build.state === "failed" ? `Build paused with ${data.build.ready} of ${data.build.total} lessons ready.`
                  : `Building ${data.build.ready} of ${data.build.total} lessons.`}</p>
                {data.build.state !== "refused" && <button type="button" className="lq-btn lq-btn-surface" disabled={loading} onClick={reload}>Check progress</button>}
                {data.build.state === "failed" && <button type="button" className="lq-btn lq-btn-blue" onClick={() => void retry()}>Retry build</button>}
                {retryFailed && <p role="alert">Couldn't retry this build. Try again.</p>}
              </div>
            )}
            {data.sections.length === 0 ? ready && <p>No sections are available.</p> : <>
              <nav className="lq-card lq-roadmap-panel" aria-label="Roadmap sections">
                <h2>Roadmap</h2>
                <ol>
                  {data.sections.map((section) => <li key={section.slug}><a href={`#${section.slug}`}>{section.title}</a></li>)}
                </ol>
              </nav>
              {data.sections.map((section) => {
                const done = section.lessons.filter((lesson) => lesson.total > 0 && lesson.done >= lesson.total).length;
                return (
                  <section key={section.slug} id={section.slug} className="lq-card lq-roadmap-panel"
                    ref={hash === section.slug ? scrollToSection : undefined}>
                    <h2>{section.title}</h2>
                    <p className="lq-tagline">{section.description}</p>
                    <p>{done} of {section.lessons.length} lessons complete</p>
                    <ol className="lq-roadmap-lessons">
                      {section.lessons.map((lesson) => (
                        <li key={lesson.slug}>
                          <span>{kinds[lesson.kind]}</span>
                          {ready && lesson.writeState === "ready" && lesson.missingPrerequisites.length === 0
                            ? <Link to="/lessons" search={{ path: slug, lesson: lesson.slug, course: section.slug }} className="lq-roadmap-lesson-link">{lesson.title}</Link>
                            : <span>{lesson.title}</span>}
                          <span>{lesson.total > 0 && lesson.done >= lesson.total ? "Complete"
                            : lesson.missingPrerequisites.length > 0 ? "Prerequisites needed"
                            : lesson.writeState === "writing" ? "Building"
                            : lesson.writeState === "failed" ? "Build paused"
                            : lesson.writeState === "pending" ? (data.build ? "Queued" : "Needs generation")
                            : lesson.done > 0 ? "In progress" : "Ready"}</span>
                        </li>
                      ))}
                    </ol>
                    {ready && <Link to="/courses/$slug" params={{ slug: section.slug }} search={{ path: slug }} className="lq-btn lq-btn-surface">Open section</Link>}
                  </section>
                );
              })}
            </>}
          </>}
      </main>
    </div>
  );
}
