import { Link, useLocation, useParams } from "@tanstack/react-router";
import { useMachine } from "@xstate/react";
import { ArrowLeft, Check, CircleAlert, ListTree, Route } from "lucide-react";
import { Spinner } from "../components/Bits";
import { isNotFound, type RouterOutputs } from "../lib/trpc";
import { roadmapBuild } from "./roadmapBuild";
import "./home.css";
import "./roadmap.css";

const lessonTitle = (title: string, kind: string) => title.replace(new RegExp(`^${kind}:\\s*`, "i"), "");

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
  const lessons = data?.sections.flatMap((section) => section.lessons) ?? [];
  const completed = lessons.filter((lesson) => lesson.total > 0 && lesson.done >= lesson.total).length;
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
              <section className="lq-roadmap-overview lq-card" aria-labelledby="overview-title">
                <div className="lq-roadmap-overview-top">
                  <div><span className="lq-roadmap-eyebrow">Your learning path</span><h2 id="overview-title">Where you’re headed</h2></div>
                  <span className="lq-roadmap-topic-count">{data.roadmap.topics.length} topics</span>
                </div>
                <div className="lq-roadmap-endpoints">
                  <div><span>Start here</span><p>{data.roadmap.startingPoint}</p></div>
                  <div><span>Your goal</span><p>{data.roadmap.destination}</p></div>
                </div>
                <details className="lq-roadmap-topics">
                  <summary>Explore the topics</summary>
                  <ul>{data.roadmap.topics.map((topic) => <li key={topic.title}><strong>{topic.title}</strong><p>{topic.outcome}</p></li>)}</ul>
                </details>
              </section>
            )}
            {lessons.length > 0 && <section className="lq-roadmap-progress" aria-label="Your progress">
              <div><h2>Your progress</h2><span>{completed} of {lessons.length} lessons complete</span></div>
              <progress aria-label="Lessons completed" max={lessons.length} value={completed} />
            </section>}
            {ready && start && data.build && (
              <div><Link to="/lessons" search={{ ...start, path: slug }} state={{ lessonEntrySource: "course_cta" }} className="lq-btn lq-btn-blue">Start</Link></div>
            )}
            {data.sections.length === 0 ? ready && <p>No sections are available.</p> : <>
              <div className="lq-roadmap-journey-heading"><span className="lq-roadmap-eyebrow">Step by step</span><h2>Your path</h2><p>Follow the lessons in order, one step at a time.</p></div>
              <div className="lq-roadmap-journey">
              {data.sections.map((section, sectionIndex) => {
                const done = section.lessons.filter((lesson) => lesson.total > 0 && lesson.done >= lesson.total).length;
                return (
                  <section key={section.slug} id={section.slug} className="lq-card lq-roadmap-panel lq-roadmap-section"
                    ref={hash === section.slug ? scrollToSection : undefined}>
                    <span className="lq-roadmap-section-number" aria-hidden="true">{sectionIndex + 1}</span>
                    <span className="lq-roadmap-eyebrow">Part {sectionIndex + 1}</span>
                    <h2>{section.title}</h2>
                    <p className="lq-tagline">{section.description}</p>
                    <p>{done} of {section.lessons.length} lessons complete</p>
                    <ol className="lq-roadmap-lessons">
                      {section.lessons.map((lesson) => (
                        <li key={lesson.slug} data-complete={lesson.total > 0 && lesson.done >= lesson.total}>
                          <span className="lq-roadmap-lesson-dot" aria-hidden="true">{lesson.total > 0 && lesson.done >= lesson.total ? <Check size={14} /> : null}</span>
                          <div className="lq-roadmap-lesson-copy"><span className="lq-roadmap-lesson-kind">{kinds[lesson.kind]}</span>
                          {ready && lesson.writeState === "ready" && lesson.missingPrerequisites.length === 0
                            ? <Link to="/lessons" search={{ path: slug, lesson: lesson.slug, course: section.slug }} className="lq-roadmap-lesson-link">{lessonTitle(lesson.title, kinds[lesson.kind])}</Link>
                            : <span>{lessonTitle(lesson.title, kinds[lesson.kind])}</span>}
                          <span>{lesson.total > 0 && lesson.done >= lesson.total ? "Complete"
                            : lesson.missingPrerequisites.length > 0 ? `Requires: ${lesson.missingPrerequisites.join(", ")}`
                            : lesson.writeState === "writing" ? "Building"
                            : lesson.writeState === "failed" ? "Build paused"
                            : lesson.writeState === "pending" ? (data.build ? "Queued" : "Needs generation")
                            : lesson.done > 0 ? "In progress" : "Ready"}</span></div>
                        </li>
                      ))}
                    </ol>
                    {ready && <Link to="/courses/$slug" params={{ slug: section.slug }} search={{ path: slug }} className="lq-btn lq-btn-surface">Open section</Link>}
                  </section>
                );
              })}
              </div>
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
