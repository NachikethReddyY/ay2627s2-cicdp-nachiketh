import { useState } from "react";
import { ArrowRight, Check, CircleHelp, FileCode2, ListChecks, Play, Puzzle, Sprout, Terminal, Workflow } from "lucide-react";
import { DitherField } from "../components/DitherField";
import PredictDemo from "../components/PredictDemo";
import "./landing.css";

// The same lesson, met two ways. Each row pairs what watching gives you with what guessing first gives you.
const swaps = [
  ["You watch someone else type.", "You say what the next line does before you see it."],
  ["It all makes sense while it plays.", "A wrong guess shows you exactly what to review."],
  ["Everyone gets the same video.", "Your next step depends on what you got right."],
];

// The kinds of part a lesson can mix.
const parts = [
  { name: "Diagram", icon: Workflow, body: "A picture of how the code runs: the call flow, the state, the shape of the data. You see it before you read a line." },
  { name: "Predict", icon: CircleHelp, body: "You say what the next change does. Nothing is revealed until you answer, and hints come one rung at a time." },
  { name: "Replay", icon: Play, body: "The editor replays the change with narration. It is rebuilt from the diff, so it is never a screen recording." },
  { name: "Quiz", icon: ListChecks, body: "A few quick questions check that the idea stuck, not just the answer to the last step." },
  { name: "Game", icon: Puzzle, body: "A short game drills the idea a second way, such as tracing a loop or putting the steps of a function call in order." },
  { name: "Practice", icon: Terminal, body: "You write the code yourself, run it in the browser, and it is checked for you." },
];

const mastery: [string, number][] = [
  ["Loops", 72],
  ["Functions", 45],
  ["Conditionals", 18],
];

const lessons = ["variables", "conditionals", "loops", "functions"];

const rules = [
  "It never shows the answer before you guess.",
  "A hint is a nudge. It is never the answer.",
  "There is no chatbot to do the work for you.",
  "A person checks every lesson before it is published.",
];

/** A lesson as a row of parts. Pick one to read what it is. */
function LessonParts() {
  const [on, setOn] = useState(1);
  const part = parts[on];
  return (
    <div className="lp-parts">
      <div className="lp-segbar" role="group" aria-label="Parts of a lesson">
        {parts.map((p, i) => (
          <button key={p.name} type="button" className="lp-part" aria-pressed={i === on} onClick={() => setOn(i)}>
            <p.icon size={16} strokeWidth={2} aria-hidden />
            {p.name}
          </button>
        ))}
      </div>
      <div className="lp-part-body" aria-live="polite">
        <span className="lp-part-ic" aria-hidden><part.icon size={20} strokeWidth={2} /></span>
        <div>
          <h3 className="lp-part-name">{part.name}</h3>
          <p className="lp-part-text">{part.body}</p>
        </div>
      </div>
    </div>
  );
}

const Logo = () => (
  <>
    <span className="lp-mark" aria-hidden><Sprout size={16} strokeWidth={2.25} /></span>
    <span>LearnSlop</span>
  </>
);

export default function Landing() {
  return (
    <div className="lp">
      <a href="#main" className="lp-skip">Skip to content</a>

      <header className="lp-nav">
        <a href="/" className="lp-logo" aria-label="LearnSlop home"><Logo /></a>
        <nav className="lp-navr" aria-label="Main">
          <span className="lp-seg">
            <a href="#lesson" className="lp-segl">How it works</a>
            <a href="#rules" className="lp-segl">Rules</a>
          </span>
          <a href="/login" className="lp-signin">Sign in</a>
          <a href="/login" className="lp-btn lp-btn-sm">Try it</a>
        </nav>
      </header>

      <main id="main">
        <section className="lp-wrap lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-head">
            <h1 id="hero-title" className="lp-h1">
              <span className="lp-line">Guess the next <span className="lp-blank">line</span>.</span>
              <span className="lp-line lp-h1-2">Then watch it get written.</span>
            </h1>
            <div className="lp-hero-side">
              <a href="#tracks" className="lp-pill">
                <b>First track</b>
                <span>JavaScript and TypeScript</span>
                <ArrowRight size={14} strokeWidth={2.25} aria-hidden />
              </a>
              <p className="lp-fine">For beginners and early-career developers.</p>
            </div>
          </div>
          <div className="lp-hero-copy">
            <p className="lp-lead">
              LearnSlop turns a real code change into a short lesson. You say what the change does, then the editor
              replays it. What you get right decides what comes next.
            </p>
            <div className="lp-cta-row">
              <a href="/play" className="lp-btn">Play a step <ArrowRight size={16} strokeWidth={2.25} aria-hidden /></a>
              <a href="#try" className="lp-btn lp-btn-quiet">Try a sample below</a>
            </div>
          </div>
        </section>

        <section className="lp-stage" aria-labelledby="try-title">
          <h2 id="try-title" className="lp-vh">Try a sample step</h2>
          <div className="lp-stage-in">
            <PredictDemo />
          </div>
        </section>

        <section className="lp-wrap lp-sec lp-split" aria-labelledby="why-title">
          <div>
            <h2 id="why-title" className="lp-h2">A tutorial lets you nod along. A guess makes you commit.</h2>
            <p className="lp-body">
              Watching feels like learning because nothing asks you to be wrong. LearnSlop asks first, every time.
            </p>
          </div>
          <div className="lp-compare">
            <p className="lp-compare-head" aria-hidden><span>Watching</span><span>Guessing first</span></p>
            <ul>
              {swaps.map(([watch, guess]) => (
                <li key={watch}>
                  <p className="lp-old"><span className="lp-vh">Watching: </span>{watch}</p>
                  <p className="lp-new"><span className="lp-vh">Guessing first: </span>{guess}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="lesson" className="lp-wrap lp-sec" aria-labelledby="parts-title">
          <div className="lp-sec-head">
            <h2 id="parts-title" className="lp-h2">One lesson, six kinds of part.</h2>
            <p className="lp-body">
              A lesson is a short run of parts like these. The mix, the depth of the hints and the lesson that comes
              next are picked from what you got right. Pick a part to see what it is.
            </p>
          </div>
          <LessonParts />
        </section>

        <section className="lp-wrap lp-sec lp-split lp-split-wide" aria-labelledby="mastery-title">
          <div className="lp-card">
            <p className="lp-card-label"><span>Your mastery</span><span className="lp-tag">Example</span></p>
            <ul className="lp-bars">
              {mastery.map(([name, value]) => (
                <li key={name} className="lp-bar">
                  <span>{name}</span>
                  <div className="lp-meter" role="meter" aria-label={`${name} mastery`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
                    <div className="lp-fill" style={{ width: `${value}%` }} />
                  </div>
                  <span className="lp-pct">{value}%</span>
                </li>
              ))}
            </ul>
            <p className="lp-next">Next up: <strong>Conditionals</strong>. It is your lowest unlocked concept.</p>
          </div>
          <div>
            <h2 id="mastery-title" className="lp-h2">Hints help. They do not count.</h2>
            <p className="lp-body">
              Every first attempt updates a model of what you know. In the step above, a right answer on the first try
              moves Loops from 20% to 58%. The same answer after a hint moves it to 23%.
            </p>
            <p className="lp-body">
              So watching never counts as learning, and every recommendation tells you why it was picked.
            </p>
          </div>
        </section>

        <section id="tracks" className="lp-wrap lp-sec lp-split" aria-labelledby="tracks-title">
          <div>
            <h2 id="tracks-title" className="lp-h2">JavaScript and TypeScript come first.</h2>
            <p className="lp-body">
              The first lessons cover variables, conditionals, loops and functions. They are built from real code
              changes, not toy snippets.
            </p>
            <p className="lp-body">
              They are still being written and checked, so there is no catalogue to browse yet.
            </p>
          </div>
          <div className="lp-card">
            <p className="lp-card-label"><span>javascript-typescript</span><span className="lp-tag">First track</span></p>
            <ul className="lp-lessons">
              {lessons.map((l) => (
                <li key={l}>
                  <FileCode2 size={18} strokeWidth={1.75} aria-hidden />
                  <span className="lp-lesson-name">{l}</span>
                  <span className="lp-tag">Soon</span>
                </li>
              ))}
              <li className="lp-lesson-later">
                <FileCode2 size={18} strokeWidth={1.75} aria-hidden />
                <span className="lp-lesson-name">more languages</span>
                <span className="lp-tag">Later</span>
              </li>
            </ul>
          </div>
        </section>

        <section id="rules" className="lp-wrap lp-sec lp-split lp-split-wide lp-split-top" aria-labelledby="rules-title">
          <h2 id="rules-title" className="lp-h2">The rules it plays by</h2>
          <ul className="lp-rules">
            {rules.map((r) => (
              <li key={r}>
                <span className="lp-tick" aria-hidden><Check size={15} strokeWidth={2.75} /></span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-wrap lp-sec" aria-labelledby="finale-title">
          <div className="lp-finale">
            <DitherField className="lp-finale-mark" pattern="glow" color={["#5b82ea", "#bcd0ff", "#ffffff"]} intensity={0.7} dotSize={2} aria-hidden>
              <Sprout size={64} strokeWidth={2} />
            </DitherField>
            <h2 id="finale-title" className="lp-finale-title">What does the next line do? Take a guess.</h2>
            <a href="/play" className="lp-btn">Play a step <ArrowRight size={16} strokeWidth={2.25} aria-hidden /></a>
          </div>
        </section>
      </main>

      <footer className="lp-wrap">
        <div className="lp-footer">
          <span className="lp-logo"><Logo /></span>
          <span className="lp-footer-r">
            <a href="/changelog" className="lp-footlink">Changelog</a>
            <span>A CICDP course project</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
