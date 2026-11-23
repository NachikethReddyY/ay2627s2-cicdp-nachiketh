import { useRef, useState } from "react";
import EditorPane from "../EditorPane";
import { FOCUS } from "../ui";
import { RunOutput } from "./RunBottom";
import type { PracticeLanguage } from "./checkModel";
import { usePracticeRunner } from "./usePracticeRunner";

function runnableLanguage(path: string): PracticeLanguage | undefined {
  if (/\.[cm]?js$/.test(path)) return "javascript";
  if (/\.[cm]?ts$/.test(path)) return "typescript";
  if (/\.py$/.test(path)) return "python";
}

export default function ReplayFork({ lessonId, files, initialPath }: { lessonId: string; files: Readonly<Record<string, string>>; initialPath: string }) {
  const [draft, setDraft] = useState(files);
  const [path, setPath] = useState(initialPath);
  const runRef = useRef<HTMLButtonElement>(null);
  const language = runnableLanguage(path);
  const value = draft[path] ?? "";
  const runner = usePracticeRunner({ lessonId, language: language ?? "javascript", code: value, openTerminal: () => {}, standalone: true });
  return (
    <div className="flex h-[min(70dvh,42rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
        <label htmlFor="fork-file" className="text-sm font-medium">File</label>
        <select id="fork-file" value={path} onChange={(event) => setPath(event.target.value)} className={`pill min-h-11 min-w-0 max-w-full px-2 text-sm ${FOCUS}`}>
          {Object.keys(files).map((file) => <option key={file} value={file}>{file}</option>)}
        </select>
        <button ref={runRef} type="button" disabled={!language || runner.busy} onClick={() => void runner.run()} className={`btn min-h-11 px-4 disabled:opacity-50 ${FOCUS}`}>Run</button>
        <p className="w-full text-sm text-[var(--mu)]">Edits are temporary. Run executes the selected JavaScript, TypeScript or Python file on its own.</p>
      </div>
      <EditorPane
        key={path}
        transportRef={runRef}
        fill
        edit={{ value, language: language ?? "plaintext", onChange: (next) => setDraft((current) => ({ ...current, [path]: next })) }}
      />
      {runner.showOutput && <RunOutput runner={runner} label="Terminal" />}
    </div>
  );
}
