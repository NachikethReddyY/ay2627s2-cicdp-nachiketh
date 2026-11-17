import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { keyAction } from "./model.ts";
import type { TimelineControl } from "./hooks/useTimeline.ts";

const btn = "pill grid h-11 w-11 shrink-0 place-items-center aria-disabled:opacity-40";

/** Play/pause, previous/next, scrub and caption for any block that has a timeline. */
export default function StepControls({ tl }: { tl: TimelineControl }) {
  const last = tl.count - 1;
  return (
    <div
      role="group"
      aria-label="Step controls"
      tabIndex={0}
      className="mt-2 flex flex-col gap-2"
      onKeyDown={(e) => {
        const a = keyAction(e.key, (e.target as HTMLElement).tagName, { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });
        if (a) { e.preventDefault(); tl.dispatch(a); }
      }}
    >
      <div className="flex items-center gap-2">
        <button type="button" className={btn} aria-label="Previous step" aria-disabled={tl.step === 0} onClick={() => tl.step > 0 && tl.dispatch("prev")}><SkipBack size={18} /></button>
        <button type="button" className={btn} aria-label={tl.playing ? "Pause" : "Play"} onClick={() => tl.dispatch("toggle")}>{tl.playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <button type="button" className={btn} aria-label="Next step" aria-disabled={tl.step === last} onClick={() => tl.step < last && tl.dispatch("next")}><SkipForward size={18} /></button>
        <input
          type="range" min={0} max={last} value={tl.step} aria-label="Scrub steps"
          className="h-11 min-w-0 flex-1 accent-[var(--ac)]"
          onChange={(e) => tl.dispatch({ goto: Number(e.target.value) })}
        />
        <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--mu)]">{tl.step + 1} of {tl.count}</span>
      </div>
      <p aria-live="polite" className="min-h-6 break-words text-sm font-medium">{tl.caption}</p>
    </div>
  );
}
