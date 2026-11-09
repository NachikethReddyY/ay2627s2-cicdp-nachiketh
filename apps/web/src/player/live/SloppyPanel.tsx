import "../workbench/workbench.css";
import { AIGuide } from "../workbench/PlannedParts";

// Sloppy, the guide character, in the main player's practice view. Chat quotas and structured widgets are server-side.
export default function SloppyPanel({ fileName, code, language }: { fileName: string; code: string; language: string }) {
  return (
    <aside aria-label="Sloppy, the guide" className="wb flex min-h-0 w-80 max-w-[45%] flex-none flex-col border-l-[3px] border-ink bg-white" data-theme="light">
      <AIGuide fileName={fileName} filePath={fileName} projectRoot="." code={code} language={language} selection={null} />
    </aside>
  );
}
