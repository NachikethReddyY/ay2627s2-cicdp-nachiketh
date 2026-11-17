import { useEffect, useMemo, useRef } from "react";
import { buildTimeline, seek } from "@learnquest/player-core";
import TestEditor from "./TestEditor";
import TransportBar from "../player/TransportBar";
import { useReplay } from "../player/useReplay";
import type { EditorHandle } from "../player/EditorPane";
import lesson from "../player/fixtures/lesson1";

// Dev-only: the editor test page with the lesson player's transport controls over it.
// The controls drive the fixture lesson's timeline, and each frame is shown in the editor.
export default function TestPlayer() {
  const timeline = useMemo(() => buildTimeline(lesson.steps.map((s) => s.input)), []);
  const editorRef = useRef<EditorHandle>(null);
  const r = useReplay(timeline, (f) => editorRef.current?.show(f));
  const playRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    editorRef.current?.show(seek(timeline, 0));
  }, [timeline]);

  return (
    <div className="relative">
      <TestEditor replay={editorRef} dock={false} />
      <div className="fixed inset-x-0 bottom-4 z-40 mx-auto w-full max-w-2xl px-4">
        <TransportBar
          timeline={timeline}
          t={r.t}
          playing={r.playing}
          speed={r.speed}
          volume={100}
          muted={false}
          audio={false}
          onVolume={() => {}}
          onMute={() => {}}
          onHover={() => {}}
          faded={false}
          playRef={playRef}
          onToggle={r.toggle}
          onSeek={r.seek}
          onStep={r.stepBoundary}
          onSpeed={r.setSpeed}
        />
      </div>
    </div>
  );
}
