import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { seek, type Timeline } from "@learnquest/player-core";
import EditorPane, { type EditorHandle } from "./EditorPane";
import Window from "./Window";
import TransportBar from "./TransportBar";
import Dock from "./Dock";
import Explorer from "./Explorer";
import MenuBar from "./MenuBar";
import { stepIndexAt, useReplay } from "./useReplay";
import { useWindows, type Kind, type WinId } from "./useWindows";
import { FOCUS } from "./ui";
import "./player.css";

const KEYS: [string, string][] = [
  ["Space / K", "Play or pause"],
  ["← / →", "Back / forward 5 seconds"],
  ["Shift + ← / →", "Previous / next step"],
  [", / .", "Slower / faster"],
  ["M", "Mute or unmute"],
  ["B", "Show or hide the file sidebar"],
  ["F", "Enter or exit full screen"],
  ["E", "Focus the code editor"],
  ["Esc", "Leave the editor or full screen"],
  ["?", "Show or hide this list"],
];

const VOL_KEY = "lq.player.volume";
function loadVolume() {
  try {
    const v = JSON.parse(localStorage.getItem(VOL_KEY) ?? "null");
    if (typeof v?.volume === "number") return { volume: Math.min(100, Math.max(0, v.volume)), muted: !!v.muted };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { volume: 60, muted: false };
}

const IDLE_MS = 2500;
const desktopQuery = "(min-width: 1024px)";
const useDesktop = () =>
  useSyncExternalStore(
    (cb) => {
      const m = matchMedia(desktopQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(desktopQuery).matches,
    () => false,
  );

// `live` = a lesson from the API: one step at a time, the instructions window holds the predict/reveal panel.
// `code` swaps the replay (editor + transport bar) for the learner's own editor: practice lessons, no video.
// `narration` is the signed URL of this step's audio, when it has one; it drives the volume controls.
type Live = { idx: number; panel: ReactNode | null; footer?: ReactNode; playKey: unknown; narration?: string; code?: { title: string; tool: ReactNode; body: ReactNode } };
// Without `live` this is the bundled sample (dev only): `sample` supplies its mode and worked examples.
type Sample = { mode: "task" | "video"; examples: string[] };
type Props = { title: string; stepTitles: string[]; timeline: Timeline; live?: Live; sample?: Sample };

const icons = {
  instructions: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  code: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  play: <path d="M8 5v14l11-7z" />,
  sidebar: <path d="M4 5h16v14H4zM9 5v14" />,
};
const Icon = ({ k, cls = "size-5" }: { k: keyof typeof icons; cls?: string }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className={`${cls} fill-none stroke-ink stroke-2 [stroke-linecap:round] [stroke-linejoin:round]`}>
    {icons[k]}
  </svg>
);

export default function Player({ title, stepTitles, timeline, live, sample }: Props) {
  const task = live ? live.panel !== null : sample?.mode === "task";
  const code = live?.code;
  const editorRef = useRef<EditorHandle>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const aboutRef = useRef<HTMLDialogElement>(null);
  const deskRef = useRef<HTMLElement>(null);
  const idleTimer = useRef(0);
  const overPill = useRef(false);
  const r = useReplay(timeline, (f) => editorRef.current?.show(f));
  const desktop = useDesktop();
  const W = useWindows(deskRef, task, desktop);

  const [idle, setIdle] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [explorer, setExplorer] = useState(desktop);
  // Volume and mute drive the step's narration audio; with no narration the controls are hidden.
  const [vol, setVol] = useState(loadVolume);
  const narration = live?.narration;
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = vol.volume / 100;
    a.muted = vol.muted;
  }, [vol, narration]);
  useEffect(() => {
    // A browser may refuse autoplay before the learner has touched the page; pressing Play retries it (see toggle).
    void audioRef.current?.play().catch(() => {});
  }, [narration]);
  useEffect(() => {
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(vol));
    } catch {
      /* ignore */
    }
  }, [vol]);
  const toggleMute = () => setVol((v) => (v.muted || v.volume === 0 ? { volume: v.volume || 50, muted: false } : { ...v, muted: true }));
  const setVolume = (volume: number) => setVol({ volume, muted: false });

  const frame = useMemo(() => seek(timeline, r.t), [timeline, r.t]);
  const paths = Object.keys(frame.files);
  const viewed = picked && picked in frame.files ? picked : frame.activePath;
  const toggle = () => {
    if (!r.playing) setPicked(null); // playing makes the view follow the replay again
    // Narration follows the Play/Pause control. Play is a user gesture, so it also recovers from a refused autoplay.
    const a = audioRef.current;
    if (a) {
      if (r.playing) a.pause();
      else if (a.paused) void a.play().catch(() => {});
    }
    r.toggle();
  };

  // Auto-hide controls: only while playing on desktop and the pointer is not on the pill.
  const arm = useCallback(() => {
    clearTimeout(idleTimer.current);
    if (r.playing && desktop && !overPill.current) idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, [r.playing, desktop]);
  useEffect(() => {
    arm();
    return () => clearTimeout(idleTimer.current);
  }, [arm]);
  const wake = () => {
    setIdle(false);
    arm();
  };

  const cur = live ? live.idx : stepIndexAt(timeline, r.t);
  const N = stepTitles.length;
  const stepTitle = stepTitles[cur] ?? "";
  // Each reveal swaps in a longer timeline; play it from the start.
  const playLatest = useRef(r.play); // the effect below must run on a new reveal only, not whenever play's identity changes
  useEffect(() => {
    playLatest.current = r.play;
  });
  useEffect(() => {
    if (live?.playKey) {
      setPicked(null); // follow the replay's active file
      playLatest.current();
    }
  }, [live?.playKey]);

  const onKeyDown = (e: KeyboardEvent) => {
    wake();
    const el = e.target as HTMLElement;
    const target = W.fill?.id ?? W.frontId ?? "code";
    if (e.key === "Escape" && W.fill?.kind === "full" && !el.closest(".monaco-editor, [role=menu], dialog, select")) {
      W.toggleFull(W.fill.id);
      e.preventDefault();
      return;
    }
    if (code) return; // the replay shortcuts mean nothing without a replay
    // Keys belong to Monaco, form fields, the slider thumb (Radix handles arrows itself) and the window move handle.
    if (e.ctrlKey || e.metaKey || e.altKey || el.closest(".monaco-editor, input, select, textarea, [role=slider], [role=menubar], [role=menu], [data-move-handle]")) return;
    const onButton = el.tagName === "BUTTON"; // Space activates a focused button natively
    const k = e.key;
    if ((k === " " && !onButton) || k === "k" || k === "K") toggle();
    else if (k === "ArrowLeft") e.shiftKey ? r.stepBoundary(-1) : r.seekBy(-5000);
    else if (k === "ArrowRight") e.shiftKey ? r.stepBoundary(1) : r.seekBy(5000);
    else if (k === ",") r.slower();
    else if (k === ".") r.faster();
    else if ((k === "m" || k === "M") && narration) toggleMute();
    else if (k === "b" || k === "B") setExplorer((o) => !o);
    else if ((k === "f" || k === "F") && desktop) W.toggleFull(target);
    else if (k === "e" || k === "E") editorRef.current?.focus();
    else if (k === "?") helpRef.current?.open ? helpRef.current.close() : helpRef.current?.showModal();
    else return;
    e.preventDefault();
  };

  const showHelp = () => helpRef.current?.showModal();
  const shown = (id: WinId) => !desktop || W.state(id) === "open";
  const winProps = (id: WinId) => ({
    id: `win-${id}`,
    hidden: !shown(id),
    dockId: id,
    fill: W.fill?.id === id ? W.fill.kind : null,
    dragging: W.dragging,
    rect: desktop ? (W.rect(id) ?? { x: 0, y: 0, w: 0, h: 0, z: 0 }) : undefined,
    onClose: () => W.setState(id, "closed"),
    onMinimize: () => W.setState(id, "minimized"),
    onZoom: () => W.toggleZoom(id),
    onFull: () => W.toggleFull(id),
    onFront: () => W.front(id),
    onDrag: (k: Kind, e: React.PointerEvent) => W.drag(id, k, e),
    onNudge: (k: Kind, dx: number, dy: number) => W.nudge(id, k, dx, dy),
  });
  const codeLabel = task ? "Code" : "Player";
  const dockItem = (id: WinId, label: string, tone: string) => ({
    id,
    label,
    tone,
    icon: !task && id === "code" ? icons.play : icons[id], // video lessons show a player, not code
    running: W.state(id) !== "closed",
    pressed: W.state(id) === "open",
    onClick: () => (W.state(id) === "open" ? W.setState(id, "minimized") : W.open(id)),
  });

  return (
    <div className={`lq player-page flex flex-col ${code ? "h-dvh overflow-hidden" : "min-h-dvh lg:h-dvh lg:overflow-hidden"}`} onKeyDown={onKeyDown}>
      <header className="flex min-h-8 flex-none flex-wrap items-center gap-x-3 border-b-[3px] border-ink bg-white px-3 py-0.5 text-sm">
        <a href="/" aria-label="LearnQuest home" className={`grid min-h-6 min-w-6 place-items-center rounded-md ${FOCUS}`}>
          <img src="/img/pip-wave.png" alt="" className="size-6 object-contain" />
        </a>
        <h1 className="flex-none font-sans text-sm font-extrabold">{title}</h1>
        <MenuBar
          replay={!code}
          playing={r.playing}
          speed={r.speed}
          muted={vol.muted}
          audio={!!narration}
          explorer={explorer}
          desktop={desktop}
          full={W.fill?.kind === "full"}
          canMinimize={!!W.frontId}
          windows={[...(task ? [{ id: "instructions", label: "Instructions", open: W.state("instructions") === "open" }] : []), { id: "code", label: codeLabel, open: W.state("code") === "open" }]}
          on={{
            toggle,
            step: r.stepBoundary,
            seekBy: r.seekBy,
            speed: r.setSpeed,
            mute: toggleMute,
            sidebar: () => setExplorer((o) => !o),
            full: () => W.toggleFull(W.frontId ?? "code"),
            zoom: () => W.toggleZoom(W.frontId ?? "code"),
            minimize: () => W.frontId && W.setState(W.frontId, "minimized"),
            show: (id) => W.open(id as WinId),
            keys: showHelp,
            about: () => aboutRef.current?.showModal(),
          }}
        />
        <span className="min-w-0 flex-1 truncate font-semibold text-ink/70 max-xl:hidden">
          <span aria-hidden="true">· </span>
          {stepTitle}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {live?.footer && <div className="menu-next flex items-center gap-2">{live.footer}</div>}
          <div role="group" aria-label={`Step ${cur + 1} of ${N}`} className="flex items-center gap-1.5">
            <div aria-hidden="true" className="flex gap-0.5">
              {stepTitles.map((t, i) => (
                <span key={i} className={`h-1.5 w-4 rounded-full border-2 border-ink ${i < cur ? "bg-green" : i === cur ? "bg-sun" : "bg-white"}`} />
              ))}
            </div>
            <span aria-hidden="true" className="text-xs font-extrabold">
              {cur + 1}/{N}
            </span>
          </div>
        </div>
      </header>

      <main
        ref={deskRef}
        className={`relative flex flex-1 flex-col gap-4 bg-mint/40 p-3 lg:block lg:min-h-0 lg:p-0 ${code ? "min-h-0 overflow-y-auto lg:overflow-visible max-lg:[&>section]:flex-none" : ""}`}
      >
        {task && (
          <Window {...winProps("instructions")} label="Instructions" title="Instructions" tone="bg-mint">
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {live ? live.panel : (
                <>
                  <p className="text-sm font-extrabold text-ink/75">
                    Step {cur + 1} of {N}
                  </p>
                  <h3 className="font-display text-xl font-black">{stepTitle}</h3>
                  <p className="mt-2 font-semibold">{sample?.examples[cur]}</p>
                  <nav aria-label="Steps" className="mt-5">
                    <ol className="flex flex-col gap-2">
                      {stepTitles.map((t, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            aria-current={i === cur ? "step" : undefined}
                            onClick={() => r.seek(timeline.steps[i].startT)}
                            className={`w-full rounded-xl border-[3px] border-ink px-3 py-2 text-left text-sm font-bold ${FOCUS} ${i === cur ? "bg-sun" : "bg-paper hover:bg-mint"}`}
                          >
                            <span className="font-extrabold">{i + 1}.</span> {t}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </nav>
                </>
              )}
            </div>
          </Window>
        )}

        <Window
          {...winProps("code")}
          label={codeLabel}
          title={code ? code.title : task ? viewed || "Code" : `Player — ${viewed}`}
          tone="bg-sun"
          onPointerMove={wake}
          titleExtra={code ? code.tool : (
            <button
              type="button"
              aria-label="File explorer"
              aria-expanded={explorer}
              aria-controls="explorer"
              onClick={() => setExplorer((o) => !o)}
              className={`grid size-6 place-items-center rounded-md ${explorer ? "bg-white" : ""} ${FOCUS}`}
            >
              <Icon k="sidebar" />
            </button>
          )}
        >
          {code ? code.body : <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <Explorer
              id="explorer"
              hidden={!explorer}
              paths={paths}
              viewed={viewed}
              editing={frame.activePath}
              onPick={(p) => {
                r.pause();
                setPicked(p);
              }}
            />
            <EditorPane
              ref={editorRef}
              transportRef={playRef}
              viewPath={picked && picked in frame.files ? picked : undefined}
              overlay={
                <TransportBar
                  timeline={timeline}
                  t={r.t}
                  playing={r.playing}
                  speed={r.speed}
                  volume={vol.volume}
                  muted={vol.muted}
                  audio={!!narration}
                  onVolume={setVolume}
                  onMute={toggleMute}
                  faded={idle && r.playing && desktop}
                  onHover={(over) => {
                    overPill.current = over;
                    wake();
                  }}
                  playRef={playRef}
                  onToggle={toggle}
                  onSeek={r.seek}
                  onStep={r.stepBoundary}
                  onSpeed={r.setSpeed}
                />
              }
            />
          </div>}
        </Window>

        <Dock
          hidden={W.fill?.kind === "full"}
          items={[dockItem("code", codeLabel, "bg-sun"), ...(task ? [dockItem("instructions", "Instructions", "bg-mint")] : [])]}
        />
      </main>

      <div role="status" aria-live="polite" className="sr-only">
        Step {cur + 1}: {stepTitle}
      </div>
      {narration && <audio ref={audioRef} key={narration} src={narration} preload="auto" />}

      <dialog ref={aboutRef} aria-labelledby="about-h" className="chunk m-auto max-w-sm bg-paper p-5">
        <h2 id="about-h" className="font-display text-xl font-black">
          About this replay
        </h2>
        <p className="mt-3 text-sm font-semibold">This replay is reconstructed from the commit's diff, not a screen recording.</p>
        <button type="button" autoFocus className={`pill mt-4 min-h-11 bg-sun px-4 ${FOCUS}`} onClick={() => aboutRef.current?.close()}>
          Close
        </button>
      </dialog>

      <dialog ref={helpRef} aria-labelledby="keys-h" className="chunk m-auto max-w-sm bg-paper p-5">
        <h2 id="keys-h" className="font-display text-xl font-black">
          Keyboard shortcuts
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {KEYS.filter(([k]) => k !== "M" || narration).map(([k, d]) => (
            <div key={k} className="contents">
              <dt className="font-mono font-bold">{k}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
        <button type="button" autoFocus className={`pill mt-4 min-h-11 bg-sun px-4 ${FOCUS}`} onClick={() => helpRef.current?.close()}>
          Close
        </button>
      </dialog>
    </div>
  );
}
