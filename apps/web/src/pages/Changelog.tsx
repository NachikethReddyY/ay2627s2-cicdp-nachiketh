// Adapted from the Magic UI changelog template (https://magicui.design/docs/templates/changelog,
// source: https://github.com/magicuidesign/changelog-template), MIT licence per its README,
// copyright Magic UI contributors. The template's layout is kept: a sticky date and id column,
// a vertical line with a dot per entry, title, tag pills and a collapsible list of details.
// The cn helper is not needed, and the accordion is a native <details>, so no dependency is added.
// Styled by pages/changelog.css (`.cl`).
import { ArrowLeft, ChevronDown, Sprout } from "lucide-react";
import "./changelog.css";

type Entry = {
  /** ISO date of the commit on main */
  date: string;
  /** short commit hash, shown where the template shows a version */
  commit: string;
  title: string;
  summary: string;
  tags: string[];
  changes: string[];
};

// Every entry is a real commit on main (`git log`), newest first. Dates are the commit dates.
const entries: Entry[] = [
  {
    date: "2026-11-10",
    commit: "7f2dcb5",
    title: "A faster practice editor that also works in Safari",
    summary: "The practice workspace opens sooner and no longer gets stuck when you are signed out.",
    tags: ["Practice", "Fix"],
    changes: [
      "The sample code shows on first paint, and the sandbox syncs behind it.",
      "Folders open at once, even when you are signed out.",
      "Edits stay marked as unsaved until the save goes through.",
      "The shell reconnects when your network comes back.",
    ],
  },
  {
    date: "2026-11-10",
    commit: "cd0d61c",
    title: "Lesson content now lives in files, and steps can be read aloud",
    summary: "Adding a lesson no longer needs a code change. Lesson 1 has narration text.",
    tags: ["Lessons"],
    changes: [
      "Lesson 1 keeps its three steps and now has narration text.",
      "Lesson 2, on conditionals, is a draft and is not published.",
      "A step with no recorded narration is read aloud with your browser's speech.",
    ],
  },
  {
    date: "2026-11-09",
    commit: "a24a25f",
    title: "A learner model and a reason for every next step",
    summary: "Your first attempts update what the engine thinks you know, and it says why it picked what is next.",
    tags: ["Learning"],
    changes: [
      "Only first attempts update mastery, so a right answer after a hint counts for less.",
      "Every recommendation comes with a reason in plain words.",
      "The mastery and next-step reads never expose answers or hint text.",
    ],
  },
  {
    date: "2026-11-09",
    commit: "6d5aa93",
    title: "Practice code is checked, and Sloppy explains what it finds",
    summary: "JavaScript, TypeScript and Python practice code gets a quick lint with the rule and the line.",
    tags: ["Practice"],
    changes: [
      "Each finding lists the rule, the line and the column.",
      "Ask Sloppy explains the rule. It never gives you the corrected line.",
    ],
  },
  {
    date: "2026-11-07",
    commit: "40db997",
    title: "The practice workbench",
    summary: "Practice moved onto an editor layout with a file tree, a docs panel and a command palette.",
    tags: ["Practice", "Feature"],
    changes: [
      "A docs panel with a starter reference for JavaScript, TypeScript and Python.",
      "Hover a word in the editor to see what it means.",
      "A command palette for files, commands and docs.",
      "Light, dark and system themes.",
    ],
  },
];

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/** /changelog: a dated timeline of real changes, newest first. */
export default function Changelog() {
  return (
    <div className="cl">
      <header className="cl-head">
        <div className="cl-head-in">
          <a href="/" className="cl-logo" aria-label="LearnSlop home">
            <span className="cl-mark" aria-hidden><Sprout size={16} strokeWidth={2.25} /></span>
            <span>LearnSlop</span>
          </a>
          <a href="/" className="cl-back"><ArrowLeft size={16} strokeWidth={2.25} aria-hidden /> Back to home</a>
        </div>
      </header>
      <main className="cl-wrap">
        <h1 className="cl-h1">Changelog</h1>
        <p className="cl-lead">Real changes from the project history, newest first. Open an entry to see what changed.</p>
        <ol className="cl-list">
      {entries.map((e) => (
        <li key={e.commit} className="cl-item">
          <div className="cl-meta">
            <time dateTime={e.date} className="cl-date">{formatDate(e.date)}</time>
            <span className="cl-id"><span className="cl-vh">Commit </span>{e.commit}</span>
          </div>
          <div className="cl-main">
            <span className="cl-dot" aria-hidden />
            <h3 className="cl-title">{e.title}</h3>
            <ul className="cl-tags" aria-label="Tags">
              {e.tags.map((t) => <li key={t} className="cl-tag">{t}</li>)}
            </ul>
            <p className="cl-sum">{e.summary}</p>
            <details className="cl-more">
              <summary>
                What changed
                <ChevronDown size={16} strokeWidth={2.25} aria-hidden />
              </summary>
              <ul>
                {e.changes.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </details>
          </div>
        </li>
      ))}
        </ol>
      </main>
    </div>
  );
}
