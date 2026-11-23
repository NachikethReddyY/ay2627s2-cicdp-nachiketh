import { useMemo, type ReactNode } from "react";
import { buildTimeline } from "@learnquest/player-core";
import { Player } from "./LazyPlayer";
import type { Part } from "./types";

export default function WatchView({ lessonId, title, part, next, completed }: { lessonId: string; title: string; part: Extract<Part, { kind: "watch" }>; next: ReactNode; completed: boolean }) {
  const timeline = useMemo(() => {
    try {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: part.hunks }]);
    } catch {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: [] }]);
    }
  }, [part]);
  return <Player title={title} stepTitles={[title]} timeline={timeline} live={{ idx: 0, panel: null, forkLessonId: lessonId, footer: next, footerAfterReplay: !completed, playKey: part }} />;
}
