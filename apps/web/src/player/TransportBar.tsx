import * as Slider from "@radix-ui/react-slider";
import type { Timeline } from "@learnquest/player-core";
import { FOCUS } from "./ui";
import { SPEEDS, stepIndexAt, type Speed } from "./useReplay";

type Props = {
  timeline: Timeline;
  t: number;
  playing: boolean;
  speed: Speed;
  volume: number; // 0-100
  muted: boolean;
  audio: boolean; // false: nothing to hear, so no volume controls
  onVolume(v: number): void;
  onMute(): void;
  onHover(over: boolean): void;
  faded: boolean; // auto-hidden while playing and idle; never while focus is inside
  playRef: React.RefObject<HTMLButtonElement | null>;
  onToggle(): void;
  onSeek(t: number): void;
  onStep(dir: 1 | -1): void;
  onSpeed(s: Speed): void;
};

const SEG = 1000; // slider units per step: equal-width segments
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

const icons = {
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />,
  prev: <path d="M6 5h2.5v14H6zM20 5v14L9.5 12z" />,
  vol: <path d="M4 9h4l5-4v14l-5-4H4z" />,
  wave1: <path d="M16 9.5a4 4 0 010 5" />,
  wave2: <path d="M16 9.5a4 4 0 010 5M18.5 7a8 8 0 010 10" />,
  x: <path d="M16 9.5l5 5M21 9.5l-5 5" />,
  next: <path d="M15.5 5H18v14h-2.5zM4 5l10.5 7L4 19z" />,
};

const btn =
  `grid size-9 place-items-center pill ${FOCUS}`;

export default function TransportBar({ timeline, t, playing, speed, volume, muted, audio, onVolume, onMute, onHover, faded, playRef, onToggle, onSeek, onStep, onSpeed }: Props) {
  const { steps } = timeline;
  const n = steps.length;

  const level = muted ? 0 : volume;
  const cur = stepIndexAt(timeline, t);
  const toSlider = (ms: number) => {
    const s = steps[cur];
    const f = s.endT > s.startT ? (ms - s.startT) / (s.endT - s.startT) : 0;
    return cur * SEG + Math.min(1, Math.max(0, f)) * SEG;
  };
  const toMs = (v: number) => {
    const i = Math.min(n - 1, Math.floor(v / SEG));
    const s = steps[i];
    return s.startT + Math.min(1, (v - i * SEG) / SEG) * (s.endT - s.startT);
  };

  const icon = (k: keyof typeof icons) => (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-ink">
      {icons[k]}
    </svg>
  );

  return (
    <div
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className={`absolute bottom-4 left-1/2 z-10 flex w-[calc(100%-32px)] max-w-[640px] -translate-x-1/2 flex-col gap-2 rounded-2xl border-[3px] border-ink bg-white px-3 py-2 shadow-[4px_4px_0_var(--color-ink)] transition-opacity duration-300 motion-reduce:transition-none has-focus-visible:pointer-events-auto has-focus-visible:opacity-100 ${faded ? "pointer-events-none opacity-0" : ""}`}
    >
      <Slider.Root
        className="relative flex h-6 w-full touch-none items-center select-none"
        min={0}
        max={n * SEG}
        step={1}
        value={[toSlider(t)]}
        onValueChange={([v]) => onSeek(toMs(v))}
      >
        <Slider.Track className="track relative h-3.5 grow">
          {steps.slice(1).map((_, i) => (
            <span key={i} className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: `${((i + 1) / n) * 100}%` }} />
          ))}
          <Slider.Range className="absolute h-full bg-green" />
        </Slider.Track>
        <Slider.Thumb
          aria-label="Timeline"
          aria-valuetext={`Step ${cur + 1} of ${n}, ${mmss(t)}`}
          className="block size-6 rounded-full border-[3px] border-ink bg-sun focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-blue"
        />
      </Slider.Root>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Previous step" className={`${btn} bg-white`} onClick={() => onStep(-1)}>
          {icon("prev")}
        </button>
        <button ref={playRef} type="button" aria-label={playing ? "Pause" : "Play"} className={`${btn} ${playing ? "bg-mint" : "bg-sun"}`} onClick={onToggle}>
          {icon(playing ? "pause" : "play")}
        </button>
        <button type="button" aria-label="Next step" className={`${btn} bg-white`} onClick={() => onStep(1)}>
          {icon("next")}
        </button>
        <span className="ml-1 font-mono text-sm font-bold" aria-hidden="true">
          {mmss(t)} / {mmss(timeline.duration)}
        </span>
        {audio && <div className="group/vol ml-auto flex items-center gap-1">
          <button type="button" aria-label={muted ? "Unmute" : "Mute"} className={`grid size-8 place-items-center rounded-lg ${FOCUS}`} onClick={onMute}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-ink stroke-ink stroke-2 [stroke-linecap:round] [stroke-linejoin:round]">
              {icons.vol}
              <g className="fill-none">{level === 0 ? icons.x : level < 50 ? icons.wave1 : icons.wave2}</g>
            </svg>
          </button>
          <Slider.Root
            className="relative flex h-6 w-0 touch-none items-center opacity-0 transition-[width,opacity] select-none pointer-events-none group-focus-within/vol:pointer-events-auto group-focus-within/vol:w-20 group-focus-within/vol:opacity-100 group-hover/vol:pointer-events-auto group-hover/vol:w-20 group-hover/vol:opacity-100 max-lg:pointer-events-auto max-lg:w-20 max-lg:opacity-100"
            min={0}
            max={100}
            step={1}
            value={[level]}
            onValueChange={([v]) => onVolume(v)}
          >
            <Slider.Track className="track relative h-2.5 grow">
              <Slider.Range className="absolute h-full bg-green" />
            </Slider.Track>
            <Slider.Thumb
              aria-label="Volume"
              aria-valuetext={`${level}%`}
              className="block size-6 rounded-full border-[3px] border-ink bg-sun focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-blue"
            />
          </Slider.Root>
        </div>}
        <select
          aria-label="Playback speed"
          value={String(speed)}
          onChange={(e) => onSpeed(SPEEDS.find((s) => String(s) === e.target.value) ?? 1)}
          className={`${audio ? "" : "ml-auto "}min-h-8 min-w-9 cursor-pointer appearance-none rounded-lg border-[3px] border-ink bg-white px-1.5 text-center text-sm font-extrabold ${FOCUS}`}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={String(s)}>
              {s === "instant" ? "Instant" : `${s}×`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
