import { useMemo, type ReactNode } from "react";
import { buildTimeline } from "@learnquest/player-core";
import { Player } from "./LazyPlayer";
import type { Part } from "./types";

export default function WatchView({ title, part, next }: { title: string; part: Extract<Part, { kind: "watch" }>; next: ReactNode }) {
  const timeline = useMemo(() => {
    try {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: part.hunks }]);
    } catch {
      return buildTimeline([{ beforeFiles: part.beforeFiles, hunks: [] }]); // a bad hunk must not blank the player
    }
  }, [part]);
  // A codecast is video only: no instructions window; Next sits under the player.
  return <Player title={title} stepTitles={[title]} timeline={timeline} live={{ idx: 0, panel: null, footer: next, playKey: part }} />;
}
