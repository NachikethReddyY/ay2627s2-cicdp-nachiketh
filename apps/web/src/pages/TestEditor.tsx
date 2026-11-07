import { useRef, useState } from "react";
import Markdown from "react-markdown";
import EditorPane from "../player/EditorPane";
import { TEST_LESSONS, pickTestLesson, type TestLanguage, type TestLesson } from "./testEditorFixture";
import "./testEditor.css";
import "../player/workbench/workbench.css";

// Dev-only sandbox for building the practice workbench. Fixture data only: no sign-in, no API, no sandbox.

const BADGES: Record<string, { label: string; bg: string; fg: string }> = {
  js: { label: "JS", bg: "#F2B63A", fg: "#3B2A00" },
  ts: { label: "TS", bg: "#3178C6", fg: "#fff" },
  py: { label: "PY", bg: "#3776AB", fg: "#fff" },
  md: { label: "MD", bg: "#5B6272", fg: "#fff" },
};
const LANG_NAMES: Record<TestLanguage, string> = { javascript: "JavaScript", typescript: "TypeScript", python: "Python" };

function Badge({ path }: { path: string }) {
  const b = BADGES[path.split(".").pop() ?? ""] ?? BADGES.md;
  return (
    <span className="te-badge" style={{ background: b.bg, color: b.fg }} aria-hidden="true">
      {b.label}
    </span>
  );
}

const initialFiles = (l: TestLesson) => Object.fromEntries(l.files.map((f) => [f.path, f.path === l.fileName ? l.starter : f.body]));

export default function TestEditor() {
  const [lesson, setLesson] = useState(() => pickTestLesson(new URLSearchParams(location.search).get("language")));
  const [files, setFiles] = useState(() => initialFiles(lesson));
  const [open, setOpen] = useState(lesson.fileName);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("Ready");
  const runRef = useRef<HTMLButtonElement>(null);

  const switchTo = (lang: TestLanguage) => {
    const next = TEST_LESSONS[lang];
    setLesson(next);
    setFiles(initialFiles(next));
    setOpen(next.fileName);
    setOutput("");
    setStatus("Ready");
    history.replaceState(null, "", `?language=${lang}`);
  };

  const run = () => {
    setOutput((o) => o + lesson.output);
    setStatus("Ran (sample output)");
  };

  const openLang = open.endsWith(".md") ? "markdown" : lesson.language;

  return (
    <div className="te flex flex-col p-3 sm:p-6 lg:h-dvh">
      <div className="te-frame flex min-h-0 flex-1 flex-col">
        {/* Toolbar */}
        <header className="te-bar flex flex-wrap items-center gap-2 px-3 py-2">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-5 place-items-center rounded bg-[var(--ac)] text-[10px] font-bold text-white" aria-hidden="true">
              LS
            </span>
            LearnSlop
          </a>
          <span className="te-muted text-sm">/ {lesson.title} /</span>
          <span className="flex items-center gap-1.5 text-sm">
            <Badge path={open} />
            {open}
          </span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">TEST PAGE</span>
          <div className="ml-auto flex flex-wrap items-center gap-1" role="group" aria-label="Sample language">
            {(Object.keys(TEST_LESSONS) as TestLanguage[]).map((l) => (
              <button key={l} type="button" className="te-btn" aria-pressed={l === lesson.language} onClick={() => switchTo(l)}>
                {LANG_NAMES[l]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button ref={runRef} type="button" className="te-btn te-btn-primary" onClick={run}>
              Run
            </button>
            <button type="button" className="te-btn" onClick={() => setStatus("Check needs a real lesson")}>
              Check
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Navigator */}
          <nav className="te-side flex-none border-[var(--line)] p-2 lg:w-[232px] lg:border-r" aria-label="Files">
            <p className="te-muted px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide">Files</p>
            <ul>
              {lesson.files.map((f) => (
                <li key={f.path}>
                  <button type="button" className="te-row" aria-current={f.path === open} onClick={() => setOpen(f.path)}>
                    <Badge path={f.path} />
                    {f.path}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Editor + output */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <EditorPane
              key={`${lesson.language}:${open}`}
              theme="learnslop-light"
              fontFamily={'"Geist Mono", ui-monospace, monospace'}
              transportRef={runRef}
              edit={{ value: files[open] ?? "", language: openLang, onChange: (v) => setFiles((fs) => ({ ...fs, [open]: v })) }}
            />
            <section className="te-side flex h-44 flex-none flex-col border-t border-[var(--line)]" aria-label="Output">
              <div className="flex items-center px-3 py-1">
                <span className="te-muted text-[11px] font-semibold uppercase tracking-wide">Output</span>
                <button type="button" className="te-btn ml-auto" onClick={() => setOutput("")}>
                  Clear
                </button>
              </div>
              <pre className="te-out min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 pb-2">{output || "Press Run to see sample output."}</pre>
            </section>
          </main>

          {/* Instructions */}
          <aside className="flex-none border-[var(--line)] p-4 lg:w-[320px] lg:overflow-auto lg:border-l" aria-label="Instructions">
            <h2 className="text-sm font-semibold">Instructions</h2>
            <div className="te-prose mt-2 text-sm leading-relaxed">
              <Markdown>{lesson.instructions}</Markdown>
            </div>
          </aside>
        </div>

        {/* Status bar */}
        <footer className="te-bar flex items-center gap-3 border-t border-b-0 px-3 py-1 text-xs">
          <span role="status" className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
            {status}
          </span>
          <span className="te-muted ml-auto">{LANG_NAMES[lesson.language]}</span>
        </footer>
      </div>
    </div>
  );
}
