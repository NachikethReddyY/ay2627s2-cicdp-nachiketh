import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { frameAt, runCrossed, segmentAt } from "@learnquest/player-core";
import { monacoLanguage } from "../live/checkModel";
import { lessonFile } from "../live/lessonWorkbenchModel";
import RunBottom from "../live/RunBottom";
import type { Lesson, Part } from "../live/types";
import { usePracticeRunner } from "../live/usePracticeRunner";
import { formatTime } from "../live/videoModel";
import { usePanel } from "../terminal/usePanel";
import { createSpeaker, type Synth, type Utterance } from "../speech";
import FileTreeView from "../workbench/FileTreeView";
import Workbench from "../workbench/Workbench";
import type { EditorHandle } from "../EditorPane";
import WorkbenchEditor from "../workbench/WorkbenchEditor";
import GatePanel from "./GatePanel";
import { codeShown, finished, heldGate, initPlayback, narrationBySegment, partSkipTarget, planScrim, playbackReducer, scrimTimeline, silentWav, speechCue, speechView, type PlaybackAction, type SpeechCue } from "./scrimModel";
import "./scrim.css";

type ScrimPart = Extract<Part, { kind: "scrim" }>;

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

type Props = { lessonId: string; title: string; part: ScrimPart; steps: Lesson["steps"]; media: Lesson["media"]; resumeAt: number; onGateDone: (stepId: string, at: number) => Promise<void>; onLab: () => void };

export default function ScrimWatch({ lessonId, title, part, steps, media, resumeAt, onGateDone, onLab }: Props) {
  const scrim = useMemo(() => scrimTimeline(part.segments), [part.segments]);
  const plan = useMemo(() => planScrim(part.segments), [part.segments]);
  const urls = useMemo(() => narrationBySegment(media, part.segments.length), [media, part.segments.length]);
  const { clock } = scrim;
  const [state, dispatch] = useReducer(playbackReducer, null, () =>
    ({
      ...initPlayback(
      scrim,
      Object.entries(plan.stepByKey).flatMap(([key, id]) => {
        const status = steps.find((s) => s.id === id)?.state;
        return status === "revealed" || status === "skipped" ? [key] : [];
      }),
      ),
      t: resumeAt,
    }),
  );
  const [failedAudio, setFailedAudio] = useState<ReadonlySet<number>>(() => new Set());
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<EditorHandle>(null);
  const pendingSeek = useRef<number | null>(null);
  const speaker = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : createSpeaker(window.speechSynthesis as Synth | undefined, (text) => new SpeechSynthesisUtterance(text) as Utterance),
    [],
  );
  const speaking = useRef(false);
  const clockDone = useRef(false);
  const endRef = useRef<() => void>(() => {});
  const overlayRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) speaker?.cancel();
  }, [speaker]);
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
  const texts = useMemo(() => part.segments.map((segment) => segment.text), [part.segments]);
  const silentAt = (failed: ReadonlySet<number>) => part.segments.map((_, i) => (urls[i] ?? null) === null || failed.has(i));

  const applyCue = (cue: SpeechCue) => {
    if (!speaker || cue.type === "none") return;
    speaking.current = cue.type === "speak";
    clockDone.current = false;
    if (cue.type === "cancel") {
      speaker.cancel();
      return;
    }
    speaker.speak(cue.text, {
      volume: 1,
      muted,
      rate,
      onDone: () => {
        speaking.current = false;
        if (clockDone.current) {
          clockDone.current = false;
          endRef.current();
        }
      },
    });
  };

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
    applyCue(speechCue(speechView(state), speechView(next), { texts, silent: silentAt(failedAudio), jumped: action.type === "seek" }));
    editorRef.current?.show(frameAt(scrim, next.answered, next.t));
    dispatch(action);
    return next;
  };

  const tickTo = (t: number) => {
    const crossed = state.playing ? runCrossed(scrim, state.t, commit({ type: "tick", t }).t) : null;
    const edit = crossed ? scrim.edits[crossed.edit] : undefined;
    if (edit) void runner.run(edit.code);
  };

  const endSegment = () => {
    if (speaking.current) {
      clockDone.current = true;
      return;
    }
    tickTo(current.index + 1 < total ? (clock.offsets[current.index + 1] ?? clock.total) : clock.total);
  };
  endRef.current = endSegment;

  const onTime = (audio: HTMLAudioElement) => {
    if (audio.currentTime >= duration) endSegment();
    else tickTo((clock.offsets[current.index] ?? 0) + audio.currentTime);
  };

  const toggle = () => commit({ type: state.playing ? "pause" : "play" });

  const gateOrdinal = gate ? scrim.gates.findIndex((g) => g.key === gate.key) : -1;
  const gateStep = gate ? plan.stepByKey[gate.key] : undefined;
  const caption = part.segments[current.index]?.text ?? "";
  const partLabel = `Part ${current.index + 1} of ${total}`;
  const back = partSkipTarget(clock, state.t, "back");
  const forward = partSkipTarget(clock, state.t, "forward");
  const skip = (t: number | null) => {
    if (t !== null) commit({ type: "seek", t });
  };

  const overlay = (
    <div ref={overlayRef} className="scrim-overlay" data-playing={state.playing}>
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
        onError={() => {
          const failed = new Set(failedAudio).add(current.index);
          setFailedAudio(failed);
          applyCue(speechCue(speechView(state), speechView(state), { texts, silent: silentAt(failed), jumped: true }));
        }}
      />
      {gate && gateStep && (
        <section role="region" aria-label="Predict" className="scrim-gate">
          <GatePanel stepId={gateStep} ordinal={gateOrdinal} total={scrim.gates.length} onDone={() => { void onGateDone(gateStep, state.t); }} />
        </section>
      )}
      {done && (
        <button type="button" className="wb-tb wb-primary scrim-lab" onClick={onLab}>Start the lab</button>
      )}
      <p aria-live="off" className="scrim-caption">{caption}</p>
      <div className="scrim-pill">
        <div className="scrim-row">
          <button
            type="button"
            className="scrim-icon"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => {
              setMuted(!muted);
              speaker?.setVolume(muted ? 1 : 0);
            }}
          >
            {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          </button>
          <div className="scrim-transport">
            <button
              type="button"
              className="scrim-icon"
              aria-label="Previous part"
              onClick={() => skip(back)}
              disabled={gate !== null || back === null || back === state.t}
            >
              <SkipBack size={16} aria-hidden="true" />
            </button>
            <button
              ref={playRef}
              type="button"
              onClick={toggle}
              disabled={gate !== null}
              aria-label={state.playing ? "Pause" : done ? "Watch again" : "Play"}
              className="scrim-play"
            >
              {state.playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            </button>
            <button type="button" className="scrim-icon" aria-label="Next part" onClick={() => skip(forward)} disabled={gate !== null || forward === null}>
              <SkipForward size={16} aria-hidden="true" />
            </button>
          </div>
          <select
            aria-label="Speed"
            className="scrim-speed"
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
        <div className="scrim-row">
          <span className="wb-mono scrim-time">{formatTime(state.t)}</span>
          <input
            className="scrim-range"
            type="range"
            aria-label="Seek"
            min={0}
            max={clock.total}
            step={0.1}
            value={state.t}
            onChange={(e) => commit({ type: "seek", t: Number(e.target.value) })}
          />
          <span className="wb-mono scrim-time">{formatTime(clock.total)}</span>
        </div>
      </div>
    </div>
  );

  const actions = (
    <button type="button" className="wb-tb wb-primary" onClick={() => void runner.run()} disabled={runner.busy || code === ""}>
      <Play size={15} strokeWidth={1.75} aria-hidden="true" />
      {runner.busy ? "Running…" : "Run"}
    </button>
  );

  return (
    <Workbench
      title={title}
      fileName={fileName}
      language={language}
      languageLabel={languageLabel}
      navigator={<div className="min-w-0"><FileTreeView label="Lesson files" nodes={[{ name: fileName }]} open={new Set()} selected={fileName} onToggle={() => {}} onSelect={() => {}} /></div>}
      editor={<WorkbenchEditor ref={editorRef} transportRef={playRef} edit={{ value: "", language, onChange: () => {}, readOnly: true }} fill />}
      playerOverlay={overlay}
      bottom={<RunBottom runner={runner} terminalActive={panel.state.open} />}
      bottomTitle="Terminal"
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
