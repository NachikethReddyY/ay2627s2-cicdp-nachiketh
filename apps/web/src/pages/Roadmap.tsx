import { Link, useLocation, useParams } from "@tanstack/react-router";
import { useMachine } from "@xstate/react";
import { ArrowLeft, CircleAlert, ListTree, Route } from "lucide-react";
import { Spinner } from "../components/Bits";
import { isNotFound, type RouterOutputs } from "../lib/trpc";
import { roadmapBuild } from "./roadmapBuild";
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

function BuildPanel({ build, busy, retryFailed, retry }: {
  build: NonNullable<RouterOutputs["paths"]["get"]["build"]>;
  busy: boolean;
  retryFailed: boolean;
  retry: () => void;
}) {
  const { state, ready, total } = build;
  const failed = state === "failed";
  const refused = state === "refused";
  const building = state === "building";
  const title = refused ? "Try a different topic"
    : failed ? (total ? "Lesson build paused" : "Roadmap planning paused")
    : building ? "Building your lessons" : "Planning your roadmap";
  const description = refused ? "This topic couldn’t be turned into a learning path."
    : failed && !total ? "We couldn’t finish planning this path. You can retry from here."
    : total ? `${ready} of ${total} lessons ready`
    : "We’re organizing your topics and putting the lessons in order.";
  const Icon = failed || refused ? CircleAlert : building ? ListTree : Route;

  return (
    <section className="lq-card lq-roadmap-build" data-state={state} aria-labelledby="roadmap-build-title">
      <div className="lq-roadmap-build-icon"><Icon size={22} aria-hidden="true" /></div>
      <div className="lq-roadmap-build-copy">
        <div role="status">
          <h2 id="roadmap-build-title">{title}</h2>
          <p>{description}</p>
        </div>
        {total > 0 ? <progress aria-label="Lessons ready" max={total} value={ready} /> : null}
        {failed ? (
          <button type="button" className="lq-btn lq-btn-blue" disabled={busy} onClick={retry}>{busy ? "Retrying…" : "Retry build"}</button>
        ) : refused ? <Link to="/" className="lq-btn lq-btn-surface">Back to Home</Link> : null}
        {retryFailed ? <p role="alert">Couldn't retry this build. Try again.</p> : null}
      </div>
    </section>
  );
}

function RoadmapPage({ slug }: { slug: string }) {
  const hash = useLocation({ select: (location) => location.hash });
  const [snapshot, send] = useMachine(roadmapBuild, { input: { slug } });
  const { data, error, retryFailed } = snapshot.context;

  const ready = !data?.build || data.build.state === "ready";
  const start = data?.sections.flatMap((section) => section.lessons
    .filter((lesson) => lesson.writeState === "ready" && lesson.missingPrerequisites.length === 0 && lesson.done < lesson.total)
    .map((lesson) => ({ course: section.slug, lesson: lesson.slug })))[0];

  return (
    <div className="lq lq-moon">
      <main className="lq-roadmap">
        <nav className="lq-roadmap-nav" aria-label="Main">
          <Link to="/"><ArrowLeft size={16} aria-hidden="true" /> Home</Link><Link to="/explore">Explore</Link>
        </nav>
        {!data ? (error ? <div className="lq-card lq-roadmap-panel">
          <p role="alert">{isNotFound(error) ? "We couldn't find that path." : "Couldn't load this roadmap."}</p>
          {!isNotFound(error) ? <button type="button" className="lq-btn lq-btn-surface" disabled={snapshot.matches("loading")} onClick={() => send({ type: "REFRESH" })}>Try again</button> : null}
        </div> : <Spinner />) : <>
            <header className="lq-roadmap-heading">
              <h1>{data.title}</h1>
              {data.tagline ? <p className="lq-tagline">{data.tagline}</p> : null}
            </header>
            {data.build && !ready ? <BuildPanel build={data.build} busy={!snapshot.matches("loaded")}
              retryFailed={retryFailed} retry={() => send({ type: "RETRY" })} /> : null}
            {error ? <div className="lq-roadmap-actions">
              <p role="status">Couldn't refresh build progress.</p>
              <button type="button" className="lq-btn lq-btn-surface" disabled={snapshot.matches("loading")} onClick={() => send({ type: "REFRESH" })}>Refresh</button>
            </div> : null}
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

export default function Roadmap() {
  const { slug } = useParams({ from: "/paths/$slug" });
  return <RoadmapPage key={slug} slug={slug} />;
}
