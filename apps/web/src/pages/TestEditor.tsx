import { useRef, useState } from "react";
import { Check, ChevronDown, Folder, Play } from "lucide-react";
import Markdown from "react-markdown";
import { usePanel } from "../player/terminal/usePanel";
import FileBadge from "../player/workbench/FileBadge";
import Workbench from "../player/workbench/Workbench";
import WorkbenchEditor from "../player/workbench/WorkbenchEditor";
import type { WorkbenchStatus } from "../player/workbench/StatusBar";
import { TEST_DOCS, pickTestLesson, type TestLesson } from "./testEditorFixture";

// Dev-only page for building the practice workbench. Fixture data only: no sign-in, no API, no sandbox.

const READY: WorkbenchStatus = { text: "Ready" };

const initialFiles = (l: TestLesson) => Object.fromEntries(l.files.map((f) => [f.path, f.path === l.fileName ? l.starter : f.body]));

export default function TestEditor() {
  const [lesson] = useState(() => pickTestLesson(new URLSearchParams(location.search).get("language")));
  const [files, setFiles] = useState(() => initialFiles(lesson));
  const [open, setOpen] = useState(lesson.fileName);
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<WorkbenchStatus>(READY);
  const runRef = useRef<HTMLButtonElement>(null);
  const panel = usePanel(); // no container: the workbench clamps the height at render

  const check = () => setStatus({ text: "Check needs a real lesson", tone: "error" });

  const run = () => {
    panel.dispatch({ type: "open" });
    setOutput((o) => o + lesson.output);
    setStatus({ text: "Ran (sample output)" });
  };

  const paletteFiles = lesson.files.map((f) => ({ id: f.path, title: f.path }));
  const paletteDocs = TEST_DOCS.map((d) => ({ id: d.id, title: d.title, sub: d.snippet }));
  const paletteCommands = [
    { id: "run", title: "Run", run },
    { id: "check", title: "Check", run: check },
  ];

  const navigator = (
    <>
      {/* The sample language comes from ?language= (javascript, typescript, python). */}
      <div className="wb-row wb-row-root" aria-hidden="true">
        <ChevronDown size={10} strokeWidth={2.5} className="flex-none opacity-65" />
        <Folder size={16} strokeWidth={1.5} fill="#7aa2d8" stroke="#5f8bc8" className="flex-none" />
        practice
      </div>
      <ul aria-label="Files">
        {lesson.files.map((f) => (
          <li key={f.path}>
            <button type="button" className="wb-row" style={{ paddingLeft: 30 }} data-drawer-close aria-current={f.path === open} onClick={() => setOpen(f.path)}>
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
        <Play size={13} strokeWidth={2} fill="currentColor" aria-hidden="true" />
        Run
      </button>
      <button type="button" className="wb-tb wb-outline" onClick={check}>
        <Check size={15} strokeWidth={1.75} aria-hidden="true" />
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
      paletteFiles={paletteFiles}
      paletteCommands={paletteCommands}
      paletteDocs={paletteDocs}
      onOpenFile={setOpen}
      onOpenDoc={() => {}}
      status={status}
      panel={panel}
      showPlanned
    />
  );
}
