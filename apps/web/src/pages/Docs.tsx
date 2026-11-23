import { plans } from "@learnquest/product-limits";
import "./landing.css";
import "./landing/sections.css";
import "./docs.css";
import { Logo } from "./landing/Logo";
import { FEEDBACK_URL, REPO_URL } from "./feedback";

const sections = [
  {
    id: "what",
    title: "What LearnSlop is",
    body: [
      "LearnSlop teaches programming through short lessons that start with a prediction. You guess what a line of code will do, then the answer is shown.",
      "Lessons cover JavaScript and TypeScript. Other languages are not offered yet.",
    ],
  },
  {
    id: "lessons",
    title: "How a lesson works",
    body: [
      "Each step asks for a prediction before it reveals the answer.",
      "Hints arrive one at a time. The help chat will explain an idea, but it will not write the full solution.",
      "Your first attempt at each question updates what LearnSlop knows about that concept. An answer given after a hint does not count toward your mastery.",
    ],
  },
  {
    id: "audience",
    title: "Who it is for",
    body: ["LearnSlop is for beginners and early-career developers aged 13 and over."],
  },
] as const;

export default function Docs() {
  return (
    <div className="lp dc">
      <a href="#main" className="lp-skip">Skip to content</a>

      <header className="lp-nav">
        <a href="/" className="lp-logo" aria-label="LearnSlop home"><Logo /></a>
        <nav className="lp-navr" aria-label="Main">
          <a href="/changelog">Changelog</a>
          <a href="/login" className="lp-ghost">Sign in</a>
        </nav>
      </header>

      <main id="main" className="dc-main">
        <p className="dc-eyebrow">Docs</p>
        <h1 className="dc-h1">LearnSlop documentation</h1>
        <p className="dc-lede">How the product works, what it costs to use, and where to send feedback.</p>

        <nav className="dc-toc" aria-label="On this page">
          {[...sections.map(({ id, title }) => ({ id, title })), { id: "limits", title: "Plans and limits" }, { id: "feedback", title: "Feedback" }].map((item) => (
            <a key={item.id} href={`#${item.id}`}>{item.title}</a>
          ))}
        </nav>

        {sections.map((section) => (
          <section key={section.id} id={section.id} className="dc-section" aria-labelledby={`${section.id}-h`}>
            <h2 id={`${section.id}-h`} className="dc-h2">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}

        <section id="limits" className="dc-section" aria-labelledby="limits-h">
          <h2 id="limits-h" className="dc-h2">Plans and limits</h2>
          <p>
            Free is available now. Pro is planned, with higher limits, and has no price yet. The limits below are the maximums
            per account. Pro limits are not enforced yet, and this page is updated whenever they change.
          </p>
          {plans.map((plan) => (
            <div key={plan.id} className="dc-plan">
              <h3>
                {plan.name} <span className={`lp-plan-status is-${plan.status}`}>{plan.status === "available" ? "Available now" : "Coming soon"}</span>
              </h3>
              <p>{plan.summary}</p>
              <ul>
                {plan.limits.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          <p>Limits reset on a rolling 24 hour window, not at midnight.</p>
        </section>

        <section id="changelog" className="dc-section" aria-labelledby="changelog-h">
          <h2 id="changelog-h" className="dc-h2">Changelog</h2>
          <p>
            Each release is listed on the <a href="/changelog">changelog</a>. Releases are published on{" "}
            <a href={`${REPO_URL}/releases`}>GitHub</a>.
          </p>
        </section>

        <section id="feedback" className="dc-section" aria-labelledby="feedback-h">
          <h2 id="feedback-h" className="dc-h2">Feedback</h2>
          <p>
            Report a bug or request a feature on <a href={FEEDBACK_URL}>GitHub Issues</a>. Bug reports help most when they include the
            lesson or page, what you did, what you expected, and what happened. Do not include passwords or personal details.
          </p>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="lp-logo"><Logo /></span>
        <span>For beginners and early-career developers, 13 and over. A CICDP course project.</span>
        <a href="/changelog">Changelog</a>
        <a href={FEEDBACK_URL}>Feedback</a>
      </footer>
    </div>
  );
}
