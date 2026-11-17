import { ArrowRight, Check } from "lucide-react";
import { GuessMock, HintMock, MasteryMock, ReplayMock, TopicMock } from "./landing/Mocks";
import "./landing.css";
import "./landing/sections.css";
import { Logo } from "./landing/Logo";

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
    id: "guess", Mock: GuessMock, flip: false,
    alt: "Example of a step asking what a line does to the total, with +=, = and -= as the choices.",
    title: "Pick the answer first. Then the editor writes it.",
    body: "Every step asks what the next line will do. You choose, the editor writes the line, and you see straight away whether you were right.",
    ticks: ["The answer stays hidden until you commit", "A wrong guess shows what to review", "Your first attempt is the one that counts"],
  },
  {
    id: "replay", Mock: ReplayMock, flip: false,
    alt: "Example of a replayed code change: one line removed and two added, at step 4 of 6.",
    title: "Real code changes, replayed.",
    body: "Lessons are built from real code changes. The editor writes the change one step at a time with narration, so you see how working code actually grows.",
    ticks: ["Built from real code changes, not toy snippets", "Narrated one step at a time", "The editor rebuilds each step, it is never a screen recording", "Pauses at the line you have to predict"],
  },
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
    title: "It learns what you know.",
    body: "Your first attempt at each question updates what LearnSlop thinks you know about that concept. The next lesson, and how much help you get, follow from it.",
    ticks: ["Updates after your first attempt at each question", "Answers after a hint do not count toward mastery", "The next lesson adapts to what you know"],
  },
  {
    id: "track", Mock: TopicMock, flip: false,
    alt: "Example: asking for React hooks and getting a three step path: useState, useEffect and a custom hook.",
    title: "You choose what to learn.",
    body: "There is no fixed curriculum to work through. Tell LearnSlop what you want to learn and it builds a path around it. JavaScript and TypeScript are where it starts, and you can ask for other coding topics too.",
    ticks: ["Ask for a coding topic and get a path built for it", "Your path is built around what you ask for", "Learn at your own pace, in your own order"],
  },
] as const;

export default function Landing() {
  return (
    <div className="lp">
      <a href="#main" className="lp-skip">Skip to content</a>

      <header className="lp-nav">
        <a href="/" className="lp-logo" aria-label="LearnSlop home"><Logo /></a>
        <nav className="lp-navr" aria-label="Main">
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
            <h1 id="hero-title" className="lp-h1"><span>Guess the next line.</span> <span>Then watch it get written.</span></h1>
            <p className="lp-lead">LearnSlop turns real code changes into short JavaScript and TypeScript lessons that adapt to what you get right.</p>
            <a href="/login" className="lp-btn">Start learning <ArrowRight size={17} strokeWidth={2.25} aria-hidden /></a>
            <a href="#guess" className="lp-sub">See how it works</a>
          </div>

          <div className="lp-shot">
            <img src="/images/landing-editor.png" width={2000} height={1200} alt="The LearnSlop editor: a file tree, JavaScript code, a documentation panel, a running task tracker preview and a dock." />
          </div>
        </section>

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

        <section className="lp-close" aria-labelledby="final-title">
          <h2 id="final-title" className="lp-h2">What does the next line do?</h2>
          <a href="/login" className="lp-btn">Start learning <ArrowRight size={17} strokeWidth={2.25} aria-hidden /></a>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="lp-logo"><Logo /></span>
        <span>For beginners and early-career developers, 13 and over. A CICDP course project.</span>
        <a href="/changelog">Changelog</a>
      </footer>
    </div>
  );
}
