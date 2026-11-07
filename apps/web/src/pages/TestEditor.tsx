import { useMemo, useRef, useState } from "react";
import { Check, Play } from "lucide-react";
import Markdown from "react-markdown";
import { usePanel } from "../player/terminal/usePanel";
import FileTreeView from "../player/workbench/FileTreeView";
import { ancestors, initialOpen, toggleFolder } from "../player/workbench/fileTree";
import DocsPanel from "../player/workbench/DocsPanel";
import { DOCS } from "../player/workbench/docs";
import Workbench from "../player/workbench/Workbench";
import WorkbenchEditor from "../player/workbench/WorkbenchEditor";
import type { WorkbenchStatus } from "../player/workbench/StatusBar";
import { LESSON_DIR, TREE_ROOT, designFilePaths, designTree, languageOf, pickTestLesson, placeholderBody, type TestLesson } from "./testEditorFixture";

// Dev-only page for building the practice workbench. Fixture data only: no sign-in, no API, no sandbox.

const READY: WorkbenchStatus = { text: "Ready" };

// Files are keyed by their path in the design's tree. The lesson file and the README keep their fixture text.
const lessonPath = (l: TestLesson) => `${LESSON_DIR}/${l.fileName}`;
const LANGUAGE_LABELS: Record<string, string> = { javascript: "JavaScript", typescript: "TypeScript", python: "Python", markdown: "Markdown", json: "JSON" };
const README = `${TREE_ROOT}/README.md`;
// The lesson text lives in the README, which opens as a rendered preview.
const readmeBody = (l: TestLesson) => `# ${l.title}\n\n${l.instructions}\n`;
const initialFiles = (l: TestLesson) =>
  Object.fromEntries(
    designFilePaths(l.fileName).map((p) => [p, p === lessonPath(l) ? l.starter : (p === README ? readmeBody(l) : placeholderBody(p))]),
  );

export default function TestEditor() {
  const [lesson] = useState(() => pickTestLesson(new URLSearchParams(location.search).get("language")));
  const [files, setFiles] = useState(() => initialFiles(lesson));
  const tree = useMemo(() => designTree(lesson.fileName), [lesson]);
  const [open, setOpen] = useState(lessonPath(lesson));
  const [folders, setFolders] = useState(() => initialOpen(tree));
  // Opening a file (tree, palette) shows its row: the folders above it expand.
  const openFile = (p: string) => {
    setOpen(p);
    setFolders((f) => new Set([...f, ...ancestors(p)]));
  };
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<WorkbenchStatus>(READY);
  const [selectedDoc, setSelectedDoc] = useState("for");
  const runRef = useRef<HTMLButtonElement>(null);
  const panel = usePanel(); // no container: the workbench clamps the height at render

  const check = () => setStatus({ text: "Check needs a real lesson", tone: "error" });

  const run = () => {
    panel.dispatch({ type: "open" });
    setOutput((o) => o + lesson.output);
    setStatus({ text: "Ran (sample output)" });
  };

  const paletteFiles = designFilePaths(lesson.fileName).map((p) => {
    const at = p.lastIndexOf("/");
    return { id: p, title: p.slice(at + 1), sub: p.slice(0, at) };
  });
  const paletteDocs = DOCS.map((d) => ({ id: d.id, title: d.title, sub: d.src }));
  const paletteCommands = [
    { id: "run", title: "Run", run },
    { id: "check", title: "Check", run: check },
  ];

  // The sample language comes from ?language= (javascript, typescript, python).
  const navigator = (
    <FileTreeView
      label="Files"
      nodes={tree}
      open={folders}
      selected={open}
      onToggle={(p) => setFolders((f) => toggleFolder(f, p))}
      onSelect={openFile}
    />
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

  const docs = <DocsPanel selected={selectedDoc} onSelect={setSelectedDoc} />;

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

  const openLang = languageOf(open, lesson.language);

  return (
    <Workbench
      title={`${lesson.title} (test page)`}
      fileName={open.slice(open.lastIndexOf("/") + 1)}
      crumbs={open.split("/").slice(0, -1)}
      symbol={open === lessonPath(lesson) ? (lesson.language === "python" ? "total(numbers)" : "sum(numbers)") : undefined}
      language={lesson.language}
      navigator={navigator}
      editor={
        <>
          <div className={open === README ? "hidden" : "min-h-0 min-w-0 flex-1"}>
            <WorkbenchEditor
              modelPath={`${lesson.language}/${open}`}
              transportRef={runRef}
              edit={{ value: files[open] ?? "", language: openLang, onChange: (v) => setFiles((fs) => ({ ...fs, [open]: v })) }}
            />
          </div>
          {open === README && (
            <div className="wb-scroll wb-prose min-h-0 flex-1 px-8 py-6" aria-label="README preview" role="region" tabIndex={0}>
              <Markdown>{files[README]}</Markdown>
            </div>
          )}
        </>
      }
      bottom={bottom}
      bottomTitle="Output"
      docs={docs}
      actions={actions}
      paletteFiles={paletteFiles}
      paletteCommands={paletteCommands}
      paletteDocs={paletteDocs}
      onOpenFile={openFile}
      onOpenDoc={setSelectedDoc}
      status={status}
      languageLabel={LANGUAGE_LABELS[openLang]}
      noCursor={open === README}
      panel={panel}
      showPlanned
    />
  );
}
