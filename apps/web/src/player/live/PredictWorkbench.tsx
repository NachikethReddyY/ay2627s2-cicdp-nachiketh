import { useRef, useState, type ReactNode } from "react";
import { seek, type Timeline } from "@learnquest/player-core";
import type { EditorHandle } from "../EditorPane";
import TransportBar from "../TransportBar";
import { useReplay } from "../useReplay";
import FileTreeView from "../workbench/FileTreeView";
import Workbench from "../workbench/Workbench";
import WorkbenchEditor from "../workbench/WorkbenchEditor";

const noop = () => {};
const noFolders = new Set<string>();

export default function PredictWorkbench({ title, timeline, task, narration, revealed, finished }: {
  title: string;
  timeline: Timeline;
  task: ReactNode;
  narration?: ReactNode;
  revealed: boolean;
  finished: boolean;
}) {
  const editor = useRef<EditorHandle>(null);
  const play = useRef<HTMLButtonElement>(null);
  const showReplay = revealed && !finished && timeline.duration > 0;
  const replay = useReplay(timeline, (frame) => editor.current?.show(frame), finished ? "end" : showReplay ? "play" : undefined);
  const frame = seek(timeline, replay.t);
  const paths = Object.keys(frame.files);
  const [picked, setPicked] = useState<string>();
  const path = picked && paths.includes(picked) ? picked : frame.activePath;
  const language = path.endsWith(".py") ? "python" : /\.tsx?$/.test(path) ? "typescript" : "javascript";
  const openFile = (file: string) => {
    setPicked(file);
    editor.current?.focus();
  };

  return (
    <Workbench
      title={title}
      fileName={path}
      language={language}
      navigator={<FileTreeView label="Lesson files" nodes={paths.map((name) => ({ name }))} open={noFolders} selected={path} onToggle={noop} onSelect={openFile} />}
      editor={<div className="flex min-h-48 flex-1 flex-col max-lg:h-[min(40dvh,20rem)] max-lg:flex-none">
        <WorkbenchEditor ref={editor} viewPath={path} transportRef={play} fill />
      </div>}
      editorFooter={showReplay && <TransportBar
        inline timeline={timeline} t={replay.t} playing={replay.playing} speed={replay.speed} audio={false}
        volume={0} muted onVolume={noop} onMute={noop} onHover={noop} faded={false} playRef={play}
        onToggle={replay.toggle} onSeek={replay.seek} onStep={replay.stepBoundary} onSpeed={replay.setSpeed}
      />}
      task={<section className="wb-scroll min-w-0 overflow-auto break-words border-t border-[var(--line)] bg-[var(--tbar)] p-4 lg:border-t-0" aria-label="Predict">
        {task}
        {!finished && narration}
      </section>}
      actions={null}
      paletteFiles={paths.map((id) => ({ id, title: id }))}
      paletteCommands={[]}
      paletteDocs={[]}
      onOpenFile={openFile}
      onOpenDoc={noop}
      status={{ text: finished ? "Lesson complete" : "Read only" }}
    />
  );
}
