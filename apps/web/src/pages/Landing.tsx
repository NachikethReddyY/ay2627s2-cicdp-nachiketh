import { ArrowRight, Check } from "lucide-react";
import { HintMock, MasteryMock, TopicMock } from "./landing/Mocks";
import LearningStory from "./landing/LearningStory";
import ScrimDemo from "./landing/ScrimDemo";
import "./landing.css";
import "./landing/sections.css";
import { Logo } from "./landing/Logo";
import { plans } from "@learnquest/product-limits";
import { FEEDBACK_URL } from "./feedback-config";

const tiles = [
  { id: "a", src: "/images/tech/html.svg" },
  { id: "b", src: "/images/tech/json.svg" },
  { id: "c", src: "/images/tech/javascript.svg" },
  { id: "d", src: "/images/tech/typescript.svg" },
  { id: "e", src: "/images/tech/react.svg" },
  { id: "f", src: "/images/tech/node.svg" },
] as const;

const features = [
  {
    id: "hints", Mock: HintMock, flip: true,
    alt: "Example: two hints used, one still locked, the help chat declining to write the answer, and no mastery credit after a hint.",
    title: "Hints nudge. They never answer.",
    body: "Hints arrive one at a time, and the help chat has guardrails, so it will not write the solution for you. They are for getting unstuck, so an answer after a hint does not count toward your mastery.",
    ticks: ["One hint at a time, never the whole answer", "The help chat will not hand over a solution", "Hints and answers are kept on the server"],
  },
  {
    id: "mastery", Mock: MasteryMock, flip: true,
    alt: "Example: Strings at 58% after a clean first try, with Loops 45%, Arrays 31%, Conditionals 18% and Functions 12%.",
    title: "Review what needs another try.",
    body: "LearnSlop tracks your progress by concept and brings back earlier questions for spaced review.",
    ticks: ["See which concepts you know and where to practice", "Return to concepts at spaced intervals"],
  },
  {
    id: "track", Mock: TopicMock, flip: false,
    alt: "Example: asking for React hooks and getting a three step path: useState, useEffect and a custom hook.",
    title: "You choose what to learn.",
    body: "Pick a JavaScript or TypeScript concept and LearnSlop builds a path around it.",
    ticks: ["Learn at your own pace, in your own order"],
  },
] as const;

export default function Landing() {
  return (
    <div className="lp">
      <a href="#main" className="lp-skip">Skip to content</a>

      <header className="lp-nav">
        <a href="/" className="lp-logo" aria-label="LearnSlop home"><Logo /></a>
        <nav className="lp-navr" aria-label="Main">
          <a href="/docs">Docs</a>
          <a href="/changelog">Changelog</a>
          <a href="/login" className="lp-ghost">Sign in</a>
        </nav>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-tiles" aria-hidden>
            {tiles.map((t) => (
              <span key={t.id} className={`lp-tile lp-tile-${t.id}`}><img src={t.src} alt="" draggable={false} /></span>
            ))}
          </div>

          <div className="lp-hero-in">
            <h1 id="hero-title" className="lp-h1"><span>Learn to read</span> <span>and write code.</span></h1>
            <p className="lp-lead">Learn JavaScript and TypeScript through short reading lessons, narrated Scrims, hands-on coding practice, and spaced review.</p>
            <a href="/login" className="lp-btn">Start learning <ArrowRight size={17} strokeWidth={2.25} aria-hidden /></a>
            <a href="#learning-modes" className="lp-sub">See how it works</a>
          </div>

          <a href="#scrim-demo" className="lp-shot">
            <img src="/images/landing-editor.png" width={2000} height={1199} alt="The LearnSlop Workbench with JavaScript code, documentation, a terminal, and a live task tracker preview." />
            <span>Try the interactive Scrim <ArrowRight size={16} aria-hidden="true" /></span>
          </a>
        </section>

        <LearningStory />
        <ScrimDemo />

        {features.map(({ id, Mock, flip, alt, title, body, ticks }) => (
          <section key={id} id={id} className={`lp-feat${flip ? " is-flip" : ""}`} aria-labelledby={`${id}-title`}>
            <div className="lp-mockwrap" role="img" aria-label={alt}><Mock /></div>
            <div className="lp-text">
              <h2 id={`${id}-title`} className="lp-h2">{title}</h2>
              <p className="lp-lede">{body}</p>
              <ul className="lp-ticks">
                {ticks.map((t) => (
                  <li key={t}><Check size={16} strokeWidth={2} aria-hidden />{t}</li>
                ))}
              </ul>
            </div>
          </section>
        ))}

        <section className="lp-plans" aria-labelledby="plans-title">
          <h2 id="plans-title" className="lp-h2">Plans and limits</h2>
          <p className="lp-lede">Free is what you can use today. Pro is planned, with higher limits and no price yet.</p>
          <div className="lp-plan-grid">
            {plans.map((plan) => (
              <article key={plan.id} className="lp-plan">
                <div className="lp-plan-head">
                  <h3>{plan.name}</h3>
                  <span className={`lp-plan-status is-${plan.status}`}>{plan.status === "available" ? "Available now" : "Coming soon"}</span>
                </div>
                <p>{plan.summary}</p>
                <ul className="lp-ticks">
                  {plan.limits.map((line) => (
                    <li key={line}><Check size={16} strokeWidth={2} aria-hidden />{line}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <a href="/docs#limits" className="lp-sub">Read the full limits in the docs</a>
        </section>

        <section className="lp-close" aria-labelledby="final-title">
          <h2 id="final-title" className="lp-h2">What do you want to learn to code?</h2>
          <a href="/login" className="lp-btn">Start learning <ArrowRight size={17} strokeWidth={2.25} aria-hidden /></a>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="lp-logo"><Logo /></span>
        <span>For beginners and early-career developers, 13 and over. A CICDP course project.</span>
        <a href="/docs">Docs</a>
        <a href="/changelog">Changelog</a>
        <a href={FEEDBACK_URL}>Feedback</a>
      </footer>
    </div>
  );
}
