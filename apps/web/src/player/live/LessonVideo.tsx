import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Captions, CircleHelp, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { chapterMarks, currentChapter, explainPrompt, formatTime, nextSpeed, skipTime, type Chapter } from "./videoModel";

export type VideoSource = { src: string; type: string };

const HIDE_AFTER_MS = 2500;
const SKIP_SECONDS = 10;

// Captions and chapters are optional WebVTT files next to the video. They stay hidden from the browser's own renderer:
// the player draws the caption itself, and the chapters become marks on the seek bar.
// The lesson's teaching video. The controls sit on top of the picture, YouTube-style: a big play button while paused,
// and a bar along the bottom (seek, play, skip, time, speed, mute, full screen) that fades out while it plays.
// A source is tried in order, so a video file can fall back to an audio-only narration file.
export default function LessonVideo({ title, sources, captionsSrc, chaptersSrc, onExplain }: { title: string; sources: VideoSource[]; captionsSrc?: string; chaptersSrc?: string; onExplain?(prompt: string): void }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(Number.NaN);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [shown, setShown] = useState(true);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  const [caption, setCaption] = useState(""); // the caption on screen now
  const [hasCaptions, setHasCaptions] = useState(false);
  const [ccOn, setCcOn] = useState(true);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  // Keep the bar up while paused or focused; hide it a moment after the pointer stops moving during playback.
  const wake = () => {
    setShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShown(false), HIDE_AFTER_MS);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  // Hidden tracks still load their cues; "disabled" ones never do. React does not forward a <track>'s load event,
  // so the elements are read through refs: now if a track has already loaded, and again when it does.
  const captionsEl = useRef<HTMLTrackElement>(null);
  const chaptersEl = useRef<HTMLTrackElement>(null);
  useEffect(() => {
    const watch = (el: HTMLTrackElement | null, read: (track: TextTrack) => void) => {
      if (!el) return undefined;
      el.track.mode = "hidden";
      const run = () => read(el.track);
      if (el.readyState === HTMLTrackElement.LOADED) run();
      el.addEventListener("load", run);
      return () => el.removeEventListener("load", run);
    };
    const stopCaptions = watch(captionsEl.current, (track) => {
      setHasCaptions((track.cues?.length ?? 0) > 0);
      track.oncuechange = () => setCaption(Array.from(track.activeCues ?? []).map((c) => (c as VTTCue).text).join(" "));
    });
    const stopChapters = watch(chaptersEl.current, (track) => {
      setChapters(Array.from(track.cues ?? []).map((c) => ({ start: c.startTime, title: (c as VTTCue).text })));
    });
    return () => {
      stopCaptions?.();
      stopChapters?.();
    };
  }, [captionsSrc, chaptersSrc]);
  // The file can finish loading before React attaches its handlers, so read the length once from the element.
  useEffect(() => {
    const v = video.current;
    if (v && v.readyState >= 1) setLength(v.duration);
  }, []);
  useEffect(() => {
    if (!playing) {
      clearTimeout(hideTimer.current);
      setShown(true);
    } else wake();
  }, [playing]);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v || failed) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  };
  const seek = (to: number) => {
    if (video.current) video.current.currentTime = to;
    setTime(to);
  };
  const skip = (delta: number) => seek(skipTime(video.current?.currentTime ?? 0, delta, video.current?.duration ?? Number.NaN));
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen?.();
  };
  const explain = () => {
    if (!onExplain) return;
    video.current?.pause();
    if (document.fullscreenElement) void document.exitFullscreen(); // Sloppy sits beside the editor, so leave full screen
    onExplain(explainPrompt(caption, video.current?.currentTime ?? time));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, input")) return; // a focused control keeps its own keys
    const handled = e.key === " " || e.key === "k" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "m" || e.key === "f";
    if (!handled) return;
    e.preventDefault();
    wake();
    if (e.key === " " || e.key === "k") toggle();
    else if (e.key === "ArrowLeft") skip(-5);
    else if (e.key === "ArrowRight") skip(5);
    else if (e.key === "m") setMuted((m) => !m);
    else toggleFull();
  };

  const ctl = "flex h-7 min-w-7 flex-none items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
  const barShown = shown || !playing;
  return (
    <div className="p-3">
      <div
        ref={box}
        role="group"
        aria-label={`Lesson video: ${title}`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerMove={wake}
        onPointerLeave={() => playing && setShown(false)}
        onFocus={() => setShown(true)}
        className="group @container relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--line)] bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--ac)]"
      >
        <video
          ref={video}
          aria-label={title}
          playsInline
          preload="metadata"
          muted={muted}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setLength(e.currentTarget.duration)}
          onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
          onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
          className="h-full w-full cursor-pointer object-contain"
        >
          {captionsSrc && <track ref={captionsEl} kind="captions" srcLang="en" label="English" src={captionsSrc} />}
          {chaptersSrc && <track ref={chaptersEl} kind="chapters" srcLang="en" label="Chapters" src={chaptersSrc} />}
          {sources.map((s, i) => (
            // The browser tries each source in turn; only the last one failing means nothing can play.
            <source key={s.src} src={s.src} type={s.type} onError={i === sources.length - 1 ? () => setFailed(true) : undefined} />
          ))}
        </video>

        {failed && (
          <div role="status" className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-sm">
            The lesson video isn't ready yet.
          </div>
        )}

        {!failed && !playing && (
          <button type="button" onClick={toggle} aria-label="Play video" className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center text-[var(--ac)] drop-shadow-[0_6px_18px_rgba(0,0,0,.55)] motion-safe:transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            <Play size={full ? 84 : 52} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
          </button>
        )}

        {!failed && ccOn && caption && (
          <p className={`pointer-events-none absolute inset-x-3 text-center font-semibold leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,.9),0_0_10px_rgba(0,0,0,.7)] ${barShown ? "bottom-16" : "bottom-4"} ${full ? "text-2xl" : "text-xs"}`}>{caption}</p>
        )}

        {!failed && onExplain && (
          <button
            type="button"
            onClick={explain}
            className={`absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--acT)] backdrop-blur-sm hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white motion-safe:transition-opacity motion-safe:duration-200 ${barShown ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            <CircleHelp size={13} aria-hidden="true" /> Explain
          </button>
        )}

        {!failed && (
          <div
            className={`absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 @[320px]:px-3 @[320px]:pb-2 @[320px]:pt-8 motion-safe:transition-opacity motion-safe:duration-200 ${barShown ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            <div className="relative flex items-center">
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={Number.isFinite(length) ? length : 0}
              step={0.1}
              value={Math.min(time, Number.isFinite(length) ? length : 0)}
              onChange={(e) => seek(Number(e.currentTarget.value))}
              aria-valuetext={`${formatTime(time)} of ${formatTime(length)}${currentChapter(chapters, time) ? `, ${currentChapter(chapters, time)}` : ""}`}
              className="h-1 w-full cursor-pointer accent-[var(--ac)]"
            />
            {chapterMarks(chapters, length).map((m) => (
              <span key={m.left} title={m.title} aria-hidden="true" className="pointer-events-none absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-white/90" style={{ left: `${m.left}%` }} />
            ))}
            </div>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={ctl}>
                {playing ? <Pause size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
              </button>
              <button type="button" onClick={() => skip(-SKIP_SECONDS)} aria-label={`Back ${SKIP_SECONDS} seconds`} className={`${ctl} @max-[319px]:hidden`}><RotateCcw size={16} aria-hidden="true" /></button>
              <button type="button" onClick={() => skip(SKIP_SECONDS)} aria-label={`Forward ${SKIP_SECONDS} seconds`} className={`${ctl} @max-[319px]:hidden`}><RotateCw size={16} aria-hidden="true" /></button>
              <span className="flex-none whitespace-nowrap px-1 font-mono text-[11px] tabular-nums" aria-hidden="true">{formatTime(time)} / {formatTime(length)}</span>
              <span className="ml-auto flex items-center gap-0.5">
                {hasCaptions && (
                  <button type="button" onClick={() => setCcOn((c) => !c)} aria-label="Captions" aria-pressed={ccOn} className={`${ctl} ${ccOn ? "text-[var(--acT)]" : ""}`}>
                    <Captions size={16} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const next = nextSpeed(speed);
                    if (video.current) video.current.playbackRate = next;
                    setSpeed(next);
                  }}
                  aria-label={`Playback speed ${speed}x. Change speed`}
                  className={`${ctl} tabular-nums`}
                >
                  {speed}x
                </button>
                <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} className={ctl}>
                  {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
                </button>
                <button type="button" onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} className={ctl}>
                  {full ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
