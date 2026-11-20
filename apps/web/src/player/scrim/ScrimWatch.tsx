import { useMemo, useReducer, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { runCrossed, segmentAt } from "@learnquest/player-core";
import { monacoLanguage } from "../live/checkModel";
import { lessonFile } from "../live/lessonWorkbenchModel";
import RunBottom from "../live/RunBottom";
import type { Lesson, Part } from "../live/types";
import { usePracticeRunner } from "../live/usePracticeRunner";
import { formatTime } from "../live/videoModel";
import { usePanel } from "../terminal/usePanel";
import FileTreeView from "../workbench/FileTreeView";
import Workbench from "../workbench/Workbench";
import WorkbenchEditor from "../workbench/WorkbenchEditor";
import GatePanel from "./GatePanel";
import { codeShown, finished, heldGate, initPlayback, narrationBySegment, planScrim, playbackReducer, scrimTimeline, silentWav, type PlaybackAction } from "./scrimModel";
import "./scrim.css";

type ScrimPart = Extract<Part, { kind: "scrim" }>;

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

type Props = { lessonId: string; title: string; part: ScrimPart; steps: Lesson["steps"]; media: Lesson["media"]; onLab: () => void };

export default function ScrimWatch({ lessonId, title, part, steps, media, onLab }: Props) {
  const scrim = useMemo(() => scrimTimeline(part.segments), [part.segments]);
  const plan = useMemo(() => planScrim(part.segments), [part.segments]);
  const urls = useMemo(() => narrationBySegment(media, part.segments.length), [media, part.segments.length]);
  const { clock } = scrim;
  const [state, dispatch] = useReducer(playbackReducer, null, () =>
    initPlayback(
      scrim,
      Object.entries(plan.stepByKey).flatMap(([key, id]) => {
        const status = steps.find((s) => s.id === id)?.state;
        return status === "revealed" || status === "skipped" ? [key] : [];
      }),
    ),
  );
  const [failedAudio, setFailedAudio] = useState<ReadonlySet<number>>(() => new Set());
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const panel = usePanel();
  const { dispatch: panelDispatch } = panel;

  const language = monacoLanguage(part.language);
  const { fileName, languageLabel } = lessonFile(language);
  const code = codeShown(state);
  const runner = usePracticeRunner({ lessonId, language, code, openTerminal: () => panelDispatch({ type: "open" }) });

  const current = segmentAt(clock, state.t);
  const gate = heldGate(state);
  const done = finished(state);
  const total = part.segments.length;
  const narration = urls[current.index] ?? null;
  const silent = narration === null || failedAudio.has(current.index);
  const duration = clock.durations[current.index] ?? 0;
  const silentSrc = useMemo(() => (silent ? URL.createObjectURL(new Blob([silentWav(duration)], { type: "audio/wav" })) : null), [silent, duration]);
  const src = silent ? silentSrc : narration;

  const commit = (action: PlaybackAction) => {
    const next = playbackReducer(state, action);
    const audio = audioRef.current;
    const target = segmentAt(clock, next.t);
    if (target.index !== current.index) {
      pendingSeek.current = target.local;
    } else if (audio) {
      if (action.type !== "tick" && next.t !== state.t) audio.currentTime = target.local;
      if (next.playing && !state.playing) audio.play().catch(() => dispatch({ type: "pause" }));
      if (!next.playing && state.playing) audio.pause();
    }
    dispatch(action);
    return next;
  };

  const tickTo = (t: number) => {
    const crossed = state.playing ? runCrossed(scrim, state.t, commit({ type: "tick", t }).t) : null;
    const edit = crossed ? scrim.edits[crossed.edit] : undefined;
    if (edit) void runner.run(edit.code);
  };

  const endSegment = () => tickTo(current.index + 1 < total ? (clock.offsets[current.index + 1] ?? clock.total) : clock.total);

  const onTime = (audio: HTMLAudioElement) => {
    if (audio.currentTime >= duration) endSegment();
    else tickTo((clock.offsets[current.index] ?? 0) + audio.currentTime);
  };

  const toggle = () => commit({ type: state.playing ? "pause" : "play" });

  const gateOrdinal = gate ? scrim.gates.findIndex((g) => g.key === gate.key) : -1;
  const gateStep = gate ? plan.stepByKey[gate.key] : undefined;
  const caption = part.segments[current.index]?.text ?? "";
  const partLabel = `Part ${current.index + 1} of ${total}`;

  const editor = (
    <div className="flex min-h-0 flex-1 flex-col">
      <audio
        key={current.index}
        ref={audioRef}
        src={src ?? undefined}
        autoPlay={state.playing}
        muted={muted}
        hidden
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = rate;
          if (pendingSeek.current !== null) {
            e.currentTarget.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
        onTimeUpdate={(e) => onTime(e.currentTarget)}
        onEnded={endSegment}
        onError={() => setFailedAudio((s) => new Set(s).add(current.index))}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <WorkbenchEditor transportRef={playRef} edit={{ value: code, language, onChange: () => {}, readOnly: true }} />
      </div>
      <div className="scrim-controls flex flex-col gap-2 px-3 py-2.5">
        <p aria-live="off" className="text-sm">{caption}</p>
        {gate && gateStep && (
          <section role="region" aria-label="Predict" className="rounded-lg border border-[var(--line)] px-3 py-2.5">
            <GatePanel stepId={gateStep} ordinal={gateOrdinal} total={scrim.gates.length} onDone={() => commit({ type: "answer", key: gate.key })} />
          </section>
        )}
        {done && (
          <div>
            <button type="button" className="wb-tb wb-primary" onClick={onLab}>Start the lab</button>
          </div>
        )}
        <input
          className="scrim-range w-full"
          type="range"
          aria-label="Seek"
          min={0}
          max={clock.total}
          step={0.1}
          value={state.t}
          onChange={(e) => commit({ type: "seek", t: Number(e.target.value) })}
        />
        <div className="flex items-center gap-2">
          <button
            ref={playRef}
            type="button"
            onClick={toggle}
            disabled={gate !== null}
            aria-label={state.playing ? "Pause" : done ? "Watch again" : "Play"}
            className="grid size-8 flex-none place-items-center rounded-full bg-[var(--ac)] text-white disabled:opacity-40"
          >
            {state.playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          </button>
          <span className="wb-mono flex-none text-xs tabular-nums">{formatTime(state.t)} / {formatTime(clock.total)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--mu)]">{partLabel}</span>
          <button type="button" className="wb-tb flex-none" aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
          </button>
          <select
            aria-label="Speed"
            className="wb-tb flex-none"
            value={rate}
            onChange={(e) => {
              const next = Number(e.target.value);
              setRate(next);
              if (audioRef.current) audioRef.current.playbackRate = next;
            }}
          >
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
      </div>
    </div>
  );

  const transcript = (
    <ol aria-label="Transcript" className="wb-scroll m-0 min-h-0 flex-1 list-none overflow-auto p-2">
      {part.segments.map((segment, i) => (
        <li key={i}>
          <button
            type="button"
            aria-current={i === current.index ? "true" : undefined}
            className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${i === current.index ? "bg-[var(--sel)] font-medium" : "text-[var(--mu)]"}`}
            onClick={() => commit({ type: "seek", t: clock.offsets[i] ?? 0 })}
          >
            {segment.text}
          </button>
        </li>
      ))}
    </ol>
  );

  const actions = (
    <>
      <button type="button" className="wb-tb wb-primary" onClick={() => void runner.run()} disabled={runner.busy || code === ""}>
        <Play size={15} strokeWidth={1.75} aria-hidden="true" />
        {runner.busy ? "Running…" : "Run"}
      </button>
      <button type="button" className="wb-tb" onClick={onLab}>Go to the lab</button>
    </>
  );

  return (
    <Workbench
      title={title}
      fileName={fileName}
      language={language}
      languageLabel={languageLabel}
      navigator={<div className="min-w-0"><FileTreeView label="Lesson files" nodes={[{ name: fileName }]} open={new Set()} selected={fileName} onToggle={() => {}} onSelect={() => {}} /></div>}
      editor={editor}
      bottom={<RunBottom runner={runner} terminalActive={panel.state.open} />}
      bottomTitle="Terminal"
      docs={transcript}
      actions={actions}
      paletteFiles={[{ id: fileName, title: fileName }]}
      paletteCommands={[]}
      paletteDocs={[]}
      onOpenFile={() => {}}
      onOpenDoc={() => {}}
      status={{ text: gate ? "Paused for a prediction" : done ? "Scrim complete" : partLabel }}
      panel={panel}
    />
  );
}
