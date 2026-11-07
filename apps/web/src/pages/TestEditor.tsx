import { useRef, useState } from "react";
import Markdown from "react-markdown";
import { usePanel } from "../player/terminal/usePanel";
import FileBadge from "../player/workbench/FileBadge";
import Workbench from "../player/workbench/Workbench";
import WorkbenchEditor from "../player/workbench/WorkbenchEditor";
import type { WorkbenchStatus } from "../player/workbench/StatusBar";
import { TEST_DOCS, TEST_LESSONS, pickTestLesson, type TestLanguage, type TestLesson } from "./testEditorFixture";

// Dev-only page for building the practice workbench. Fixture data only: no sign-in, no API, no sandbox.

const LANG_NAMES: Record<TestLanguage, string> = { javascript: "JavaScript", typescript: "TypeScript", python: "Python" };
const READY: WorkbenchStatus = { text: "Ready" };

const initialFiles = (l: TestLesson) => Object.fromEntries(l.files.map((f) => [f.path, f.path === l.fileName ? l.starter : f.body]));

export default function TestEditor() {
  const [lesson, setLesson] = useState(() => pickTestLesson(new URLSearchParams(location.search).get("language")));
  const [files, setFiles] = useState(() => initialFiles(lesson));
  const [open, setOpen] = useState(lesson.fileName);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<WorkbenchStatus>(READY);
  const runRef = useRef<HTMLButtonElement>(null);
  const noContainer = useRef<HTMLElement>(null); // the workbench clamps the panel to its own centre column
  const panel = usePanel(noContainer);

  const switchTo = (lang: TestLanguage) => {
    const next = TEST_LESSONS[lang];
    setLesson(next);
    setFiles(initialFiles(next));
    setOpen(next.fileName);
    setOutput("");
    setStatus(READY);
    history.replaceState(null, "", `?language=${lang}`);
  };

  const run = () => {
    panel.dispatch({ type: "open" });
    setOutput((o) => o + lesson.output);
    setStatus({ text: "Ran (sample output)" });
  };

  const navigator = (
    <>
      <div className="wb-sec">Sample language</div>
      <div role="group" aria-label="Sample language" className="mb-2 flex flex-wrap gap-1 px-2.5">
        {(Object.keys(TEST_LESSONS) as TestLanguage[]).map((l) => (
          <button key={l} type="button" className="wb-tb wb-outline wb-small" aria-pressed={l === lesson.language} onClick={() => switchTo(l)}>
            {LANG_NAMES[l]}
          </button>
        ))}
      </div>
      <div className="wb-sec">Files</div>
      <ul>
        {lesson.files.map((f) => (
          <li key={f.path}>
            <button type="button" className="wb-row" aria-current={f.path === open} onClick={() => setOpen(f.path)}>
              <FileBadge path={f.path} />
              {f.path}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  const actions = (
    <>
      <button ref={runRef} type="button" className="wb-tb wb-primary" onClick={run} title="Run">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M8 5l12 7-12 7z" />
        </svg>
        Run
      </button>
      <button type="button" className="wb-tb wb-outline" onClick={() => setStatus({ text: "Check needs a real lesson", tone: "error" })}>
        Check
      </button>
    </>
  );

  const docs = (
    <>
      <p className="text-[11.5px] text-[var(--mu)]">Sample docs (the real panel comes later)</p>
      <ul>
        {TEST_DOCS.map((d) => (
          <li key={d.id}>
            <strong>{d.title}</strong> <span className="text-[var(--mu)]">{d.snippet}</span>
          </li>
        ))}
      </ul>
    </>
  );

  const bottom = (
    <div className="flex h-full flex-col">
      <div className="flex flex-none justify-end px-2 pt-1">
        <button type="button" className="wb-tb" onClick={() => setOutput("")}>
          Clear
        </button>
      </div>
      <pre className="wb-mono min-h-0 flex-1 whitespace-pre-wrap px-3.5 pb-2 text-xs leading-[1.65]">{output || "Press Run to see sample output."}</pre>
    </div>
  );

  const openLang = open.endsWith(".md") ? "markdown" : lesson.language;

  return (
    <Workbench
      title={`${lesson.title} (test page)`}
      fileName={open}
      language={lesson.language}
      navigator={navigator}
      editor={
        <WorkbenchEditor
          key={`${lesson.language}:${open}`}
          transportRef={runRef}
          edit={{ value: files[open] ?? "", language: openLang, onChange: (v) => setFiles((fs) => ({ ...fs, [open]: v })) }}
        />
      }
      bottom={bottom}
      bottomTitle="Output"
      instructions={<Markdown>{lesson.instructions}</Markdown>}
      docs={docs}
      actions={actions}
      status={status}
      panel={panel}
    />
  );
}
