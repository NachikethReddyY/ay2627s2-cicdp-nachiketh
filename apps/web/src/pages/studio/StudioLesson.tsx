import { Suspense, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { Notice } from "../../player/live/Notice";
import { usePracticeRunner } from "../../player/live/usePracticeRunner";
import { formatTime } from "../../player/live/videoModel";
import TerminalView from "../../player/terminal/TerminalView";
import { usePanel } from "../../player/terminal/usePanel";
import FileTreeView from "../../player/workbench/FileTreeView";
import Workbench from "../../player/workbench/Workbench";
import WorkbenchEditor from "../../player/workbench/WorkbenchEditor";
import { readStudioRun } from "./studioRun";
import { STUDIO_FILE } from "./studioTimeline";
import { buildLesson, codeAt, lessonClock, openGate, reachable, runCrossed, segmentAt, type Lesson } from "./studioClock";
import type { Clip, Plan, TimedEdit } from "./studioModel";
import "./studio.css";

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
const GATE_SLACK = 0.06;

export default function StudioLesson() {
  const run = readStudioRun();
  const clips = run.clips ?? [];
  const segments = run.script?.segments ?? [];
  const [durations, setDurations] = useState<(number | null)[]>(() => clips.map(() => null));
  if (clips.length === 0 || segments.length !== clips.length) {
    return (
      <Notice>
        No lesson yet. <Link to="/studio" className="underline">Make one in the studio first.</Link>
      </Notice>
    );
  }
  const known = durations.every((d): d is number => d !== null) ? durations : null;
  return (
    <>
      {clips.map((clip, i) => (
        <audio
          key={clip.index}
          src={clip.audio}
          preload="metadata"
          hidden
          onLoadedMetadata={(e) => {
            const seconds = e.currentTarget.duration;
            setDurations((d) => d.map((v, k) => (k === i ? seconds : v)));
          }}
        />
      ))}
      {known ? (
        <Suspense fallback={<Notice><p>Loading lesson…</p></Notice>}>
          <Watch plan={run.plan} clips={clips} predicts={segments.map((s) => s.predict ?? null)} edits={run.edits ?? []} durations={known} />
        </Suspense>
      ) : (
        <Notice><p>Loading lesson…</p></Notice>
      )}
    </>
  );
}

type Cursor = { phase: "move" | "click"; x0: number; y0: number; x1: number; y1: number };

function Watch({
  plan,
  clips,
  predicts,
  edits,
  durations,
}: {
  plan?: Plan;
  clips: Clip[];
  predicts: (string | null)[];
  edits: TimedEdit[];
  durations: number[];
}) {
  const title = plan?.title ?? "Lesson";
  const lesson: Lesson = useMemo(() => buildLesson(edits, predicts, lessonClock(durations)), [edits, predicts, durations]);
  const { clock } = lesson;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [idle, setIdle] = useState(false);
  const [wake, setWake] = useState(0);
  const lastWake = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const clockRef = useRef(0);
  const runRef = useRef<HTMLButtonElement>(null);
  const editorBox = useRef<HTMLDivElement>(null);
  const transportRef = useRef<HTMLButtonElement>(null);
  const panel = usePanel();
  const { dispatch: panelDispatch } = panel;

  const code = codeAt(lesson, answered, t);
  const runner = usePracticeRunner({ lessonId: "", language: "python", code, openTerminal: () => panelDispatch({ type: "open" }) });

  const part = segmentAt(clock, t);
  const gate = openGate(lesson, answered);
  const held = gate !== null && t >= gate.t - GATE_SLACK;
  const done = t >= clock.total - GATE_SLACK && !held;

  const tune = (a: HTMLAudioElement) => {
    a.volume = volume;
    a.muted = muted;
    a.playbackRate = rate;
  };

  function moveTo(next: number, keepPlaying: boolean) {
    const target = reachable(lesson, answered, next);
    const to = segmentAt(clock, target);
    clockRef.current = target;
    setT(target);
    if (to.index === part.index && audio.current) {
      audio.current.currentTime = to.local;
      if (keepPlaying) void audio.current.play();
    } else {
      pendingSeek.current = to.local;
    }
    setPlaying(keepPlaying);
  }

  function startRun() {
    const button = runRef.current?.getBoundingClientRect();
    const box = editorBox.current?.getBoundingClientRect();
    if (!button || !box) {
      void runner.run();
      return;
    }
    setCursor({ phase: "move", x0: box.left + box.width * 0.45, y0: box.top + box.height * 0.35, x1: button.left + button.width / 2, y1: button.top + button.height / 2 });
  }

  function onTime(a: HTMLAudioElement) {
    const now = (clock.offsets[part.index] ?? 0) + a.currentTime;
    const limit = reachable(lesson, answered, now);
    const crossed = playing ? runCrossed(lesson, clockRef.current, limit) : null;
    if (limit < now - 0.01) {
      a.pause();
      setPlaying(false);
    }
    clockRef.current = limit;
    setT(limit);
    if (crossed) startRun();
  }

  function onEnded() {
    const next = part.index + 1;
    if (next >= clips.length) {
      clockRef.current = clock.total;
      setT(clock.total);
      setPlaying(false);
      return;
    }
    const start = clock.offsets[next];
    if (reachable(lesson, answered, start) < start) {
      setPlaying(false);
      return;
    }
    pendingSeek.current = 0;
    clockRef.current = start;
    setT(start);
  }

  function toggle() {
    if (held) return;
    if (done) {
      moveTo(0, true);
      return;
    }
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  }

  function carryOn() {
    if (!gate) return;
    const nextAnswered = new Set(answered).add(gate.key);
    setAnswered(nextAnswered);
    const endOfPart = gate.key.startsWith("part-");
    if (endOfPart && part.index + 1 < clips.length) {
      const start = clock.offsets[part.index + 1];
      pendingSeek.current = 0;
      clockRef.current = start;
      setT(start);
      setPlaying(true);
      return;
    }
    setPlaying(true);
    void audio.current?.play();
  }

  const clip = clips[part.index];
  const cursorStyle = cursor
    ? ({ "--x0": `${cursor.x0}px`, "--y0": `${cursor.y0}px`, "--x1": `${cursor.x1}px`, "--y1": `${cursor.y1}px` } as CSSProperties)
    : undefined;

  const actions = (
    <>
      {!done && clip && (
        <audio
          key={part.index}
          ref={audio}
          src={clip.audio}
          autoPlay={playing}
          hidden
          onLoadedMetadata={(e) => {
            tune(e.currentTarget);
            if (pendingSeek.current !== null) {
              e.currentTarget.currentTime = pendingSeek.current;
              pendingSeek.current = null;
            }
          }}
          onTimeUpdate={(e) => onTime(e.currentTarget)}
          onEnded={onEnded}
        />
      )}
      <button ref={runRef} type="button" className="wb-tb wb-primary" onClick={() => void runner.run()} disabled={runner.busy || code === ""}>
        <Play size={15} strokeWidth={1.75} aria-hidden="true" />
        {runner.busy ? "Running…" : "Run"}
      </button>
    </>
  );

  const partTitle = plan?.sections[part.index]?.goal;
  const autohide = playing && !held && !done;
  const nudge = (stamp: number) => {
    if (!idle && stamp - lastWake.current < 400) return;
    lastWake.current = stamp;
    setIdle(false);
    setWake((n) => n + 1);
  };
  const controls = (
    <div
      className="studio-glass absolute inset-x-4 bottom-4 z-10 mx-auto flex max-w-[760px] flex-col gap-2 px-3.5 pb-3 pt-2.5"
      data-autohide={autohide && !idle ? (wake % 2 === 0 ? "a" : "b") : undefined}
      data-hidden={autohide && idle ? "" : undefined}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setIdle(true);
      }}
      onFocus={() => setIdle(false)}
    >
      {held && gate && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[var(--line)] px-3 py-2">
          <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">Pause and predict: </span>{gate.question}</p>
          <button type="button" className="wb-tb wb-primary" onClick={carryOn}>Continue</button>
        </div>
      )}
      <div className="relative flex items-center">
        <input
          className="studio-range w-full"
          type="range"
          aria-label="Seek"
          min={0}
          max={clock.total}
          step={0.1}
          value={t}
          onChange={(e) => moveTo(Number(e.target.value), playing)}
        />
        {clock.offsets.slice(1).map((start, i) => (
          <span
            key={start}
            title={`Part ${i + 2}`}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--mu)]"
            style={{ left: `${(start / clock.total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          ref={transportRef}
          type="button"
          onClick={toggle}
          disabled={held}
          aria-label={playing ? "Pause" : done ? "Watch again" : "Play"}
          className="grid size-8 flex-none place-items-center rounded-full bg-[var(--ac)] text-white disabled:opacity-40"
        >
          {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
        <span className="wb-mono flex-none text-xs tabular-nums">{formatTime(t)} / {formatTime(clock.total)}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--mu)]">
          {done ? "Lesson complete" : `Part ${part.index + 1} of ${clips.length}${partTitle ? ` · ${partTitle}` : ""}`}
        </span>
        <button
          type="button"
          className="wb-tb flex-none"
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => {
            setMuted(!muted);
            if (audio.current) audio.current.muted = !muted;
          }}
        >
          {muted || volume === 0 ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
        </button>
        <input
          className="studio-range w-20 flex-none"
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolume(v);
            setMuted(false);
            if (audio.current) {
              audio.current.volume = v;
              audio.current.muted = false;
            }
          }}
        />
        <select
          aria-label="Speed"
          className="wb-tb flex-none"
          value={rate}
          onChange={(e) => {
            const r = Number(e.target.value);
            setRate(r);
            if (audio.current) audio.current.playbackRate = r;
          }}
        >
          {SPEEDS.map((sp) => <option key={sp} value={sp}>{sp}×</option>)}
        </select>
      </div>
    </div>
  );

  const bottom = (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--code)] text-[var(--tx)]">
      {runner.showOutput && (
        <section aria-labelledby="studio-out" className="flex max-h-[45%] min-h-24 flex-none flex-col border-b border-[var(--line)]">
          <div className="flex flex-none items-center gap-2 px-3 py-1">
            <h3 id="studio-out" className="text-xs font-semibold">Output</h3>
            {runner.sid && (
              <button type="button" onClick={runner.stop} className="wb-tb wb-outline ml-auto h-6 px-2 text-xs">
                <Square size={11} fill="currentColor" aria-hidden="true" /> Stop
              </button>
            )}
          </div>
          <pre aria-label="Output" tabIndex={0} className="wb-mono m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-3 pb-2 text-xs">{runner.term}</pre>
        </section>
      )}
      {runner.runNote && <p role="status" className="px-3 py-1 text-xs text-[var(--mu)]">{runner.runNote}</p>}
      <div className="relative min-h-0 flex-1 p-1">
        {runner.shell && <TerminalView shell={runner.shell} active={panel.state.open} />}
      </div>
    </div>
  );

  return (
    <>
      <Workbench
        title={title}
        fileName={STUDIO_FILE}
        language="python"
        languageLabel="Python"
        navigator={<div className="min-w-0"><FileTreeView label="Lesson files" nodes={[{ name: STUDIO_FILE }]} open={new Set()} selected={STUDIO_FILE} onToggle={() => {}} onSelect={() => {}} /></div>}
        editor={
          <div ref={editorBox} className="relative flex min-h-0 flex-1 flex-col" onPointerMove={(e) => nudge(e.timeStamp)}>
            <WorkbenchEditor transportRef={transportRef} edit={{ value: code, language: "python", onChange: () => {}, readOnly: true }} />
            {controls}
          </div>
        }
        bottom={bottom}
        docs={null}
        actions={actions}
        paletteFiles={[{ id: STUDIO_FILE, title: STUDIO_FILE }]}
        paletteCommands={[]}
        paletteDocs={[]}
        onOpenFile={() => {}}
        onOpenDoc={() => {}}
        status={{ text: held ? "Paused for a prediction" : done ? "Lesson complete" : `Part ${part.index + 1} of ${clips.length} · ${formatTime(t)}` }}
        panel={panel}
      />
      {cursor && (
        <div
          className="studio-cursor"
          data-phase={cursor.phase}
          style={cursorStyle}
          aria-hidden="true"
          onAnimationEnd={() => {
            if (cursor.phase === "move") {
              setCursor({ ...cursor, phase: "click" });
              return;
            }
            setCursor(null);
            panelDispatch({ type: "open" });
            void runner.run();
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" className="-translate-x-[3px] -translate-y-[2px]">
            <path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="white" stroke="black" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </>
  );
}
