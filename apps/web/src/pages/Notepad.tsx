import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Columns2, Eye, Maximize2, Minimize2, Pencil, Plus, X } from "lucide-react";

// Notes survive a reload in this browser only. Storage can be blocked (private windows, cleared site data), so the notepad still works without it.
const STORAGE_KEY = "lq.notepad.notes";
const LEGACY_KEY = "lq.notepad.text";
const MIN_W = 220;
const MIN_H = 160;
const DEFAULT_W = 288;
const DEFAULT_H = 288;
const SPLIT_W = 600; // wide enough for the editor and the rendered page side by side
const EDGE = 8; // keeps the header reachable when the window is dragged off the edge

type Note = { id: string; text: string };
type View = "edit" | "split" | "preview";
type Store = { notes: Note[]; activeId: string };

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function blankNote(): Note {
  return { id: newId(), text: "" };
}

// Reads the saved tabs, or migrates the single note from before tabs existed. Bad data falls back to one blank tab.
function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      const notes = Array.isArray(parsed.notes) ? parsed.notes.filter((note): note is Note => typeof note?.id === "string" && typeof note?.text === "string") : [];
      if (notes.length) return { notes, activeId: notes.some((note) => note.id === parsed.activeId) ? (parsed.activeId as string) : notes[0].id };
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const note = { id: newId(), text: legacy };
      return { notes: [note], activeId: note.id };
    }
  } catch {
    // Fall through to a blank note.
  }
  const note = blankNote();
  return { notes: [note], activeId: note.id };
}

function saveStore(store: Store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // The notes stay in memory for this session.
  }
}

// A tab is named after the first line of its text, so the tab strip needs no rename step.
function tabTitle(note: Note, index: number) {
  const first = note.text.split("\n").map((line) => line.replace(/^[#>\-*\s`]+/, "").trim()).find(Boolean);
  if (!first) return `Note ${index + 1}`;
  return first.length > 18 ? `${first.slice(0, 18)}…` : first;
}

type Box = { left: number; top: number; width: number; height: number };

/**
 * A floating scratch pad that looks like the browser preview window: same chrome, dots and tokens.
 * It must render inside the workbench (.wb) so the theme variables apply. Drag the title bar to move it,
 * drag the corner to resize, and use the dots to minimize, maximize or close. Several notes live in tabs,
 * and each one can be shown as Markdown, side by side with the source. Text is kept per browser.
 */
//
// NOTE FOR FUTURE EDITS: the lesson's instructions are shown in this window as the pinned "Instructions" tab.
// Pass them in through the `instructions` prop (Markdown, the lesson's own instructions text). Keep that tab
// when changing the notepad, and keep it read-only: it is never saved into the learner's notes.
export default function Notepad({ onClose, instructions }: { onClose(): void; instructions?: string }) {
  const [store, setStore] = useState(readStore);
  const [view, setView] = useState<View>("edit");
  // The Instructions tab is selected by default when there are instructions, and a note tab takes over when picked.
  const [onInstructions, setOnInstructions] = useState(Boolean(instructions));
  // null until the first move or resize, so the window starts at its default corner.
  const [box, setBox] = useState<Box | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const windowRef = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerX: number; pointerY: number; box: Box } | null>(null);
  const resize = useRef<{ pointerX: number; pointerY: number; box: Box } | null>(null);

  const active = store.notes.find((note) => note.id === store.activeId) ?? store.notes[0];

  function update(next: Store) {
    setStore(next);
    saveStore(next);
  }

  function editActive(text: string) {
    update({ ...store, notes: store.notes.map((note) => (note.id === active.id ? { ...note, text } : note)) });
  }

  function addTab() {
    const note = blankNote();
    setOnInstructions(false);
    update({ notes: [...store.notes, note], activeId: note.id });
  }

  // Closing the last tab leaves a blank one, so there is always a note to write in.
  function closeTab(id: string) {
    const index = store.notes.findIndex((note) => note.id === id);
    const rest = store.notes.filter((note) => note.id !== id);
    if (!rest.length) {
      const note = blankNote();
      update({ notes: [note], activeId: note.id });
      return;
    }
    const activeId = store.activeId === id ? rest[Math.max(0, index - 1)].id : store.activeId;
    update({ notes: rest, activeId });
  }

  // The box the window would have at the start of a gesture, measured if it has never moved yet.
  function currentBox(): Box {
    if (box) return box;
    const rect = windowRef.current?.getBoundingClientRect();
    return { left: rect?.left ?? window.innerWidth - DEFAULT_W - 24, top: rect?.top ?? window.innerHeight - DEFAULT_H - 24, width: rect?.width ?? DEFAULT_W, height: rect?.height ?? DEFAULT_H };
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    if (maximized) return;
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, box: currentBox() };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const start = drag.current;
    if (!start) return;
    const left = Math.min(Math.max(EDGE, start.box.left + event.clientX - start.pointerX), window.innerWidth - start.box.width - EDGE);
    const top = Math.min(Math.max(EDGE, start.box.top + event.clientY - start.pointerY), window.innerHeight - 38 - EDGE);
    setBox({ ...start.box, left, top });
  }

  function startResize(event: ReactPointerEvent<HTMLElement>) {
    if (maximized) return;
    resize.current = { pointerX: event.clientX, pointerY: event.clientY, box: currentBox() };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function moveResize(event: ReactPointerEvent<HTMLElement>) {
    const start = resize.current;
    if (!start) return;
    const width = Math.max(MIN_W, Math.min(start.box.width + event.clientX - start.pointerX, window.innerWidth - start.box.left - EDGE));
    const height = Math.max(MIN_H, Math.min(start.box.height + event.clientY - start.pointerY, window.innerHeight - start.box.top - EDGE));
    setBox({ ...start.box, width, height });
  }

  function endGesture(event: ReactPointerEvent<HTMLElement>) {
    drag.current = null;
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  // Maximize fills the workspace above the dock, and un-maximizing returns to the box the window had before.
  function toggleMaximized() {
    setMaximized((value) => !value);
    setMinimized(false);
  }

  // The stylesheet owns the maximized and minimized geometry, so inline sizes only apply to the normal window.
  // Side-by-side needs more width, so the window widens to fit it unless the learner has already made it wider.
  const style: CSSProperties = { zIndex: 61 };
  if (!maximized) {
    const baseWidth = box?.width ?? DEFAULT_W;
    const width = view === "split" ? Math.min(Math.max(baseWidth, SPLIT_W), window.innerWidth - 24) : baseWidth;
    Object.assign(style, { width });
    if (!minimized) Object.assign(style, { height: box?.height ?? DEFAULT_H });
    if (box) Object.assign(style, { left: box.left, top: box.top, right: "auto", bottom: "auto" });
  }

  const showingInstructions = Boolean(instructions) && onInstructions;
  const showEditor = !showingInstructions && view !== "preview";
  const showPreview = showingInstructions || view !== "edit";

  return (
    <section
      ref={windowRef}
      aria-label="Notepad"
      style={style}
      className={`wb-preview-float${maximized ? " wb-preview-maximized" : ""}${minimized ? " wb-preview-minimized" : ""}`}
    >
      <header
        className="wb-preview-float-head"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onDoubleClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) toggleMaximized();
        }}
      >
        <span className="wb-preview-mac-dots" role="group" aria-label="Notepad window controls">
          <button type="button" className="wb-preview-dot wb-preview-dot-close" aria-label="Close notepad" title="Close" onClick={onClose} />
          <button type="button" className="wb-preview-dot wb-preview-dot-minimize" aria-label={minimized ? "Restore notepad" : "Minimize notepad"} title={minimized ? "Restore" : "Minimize"} onClick={() => setMinimized((value) => !value)} />
          <button type="button" className="wb-preview-dot wb-preview-dot-maximize" aria-label={maximized ? "Restore notepad size" : "Maximize notepad"} title={maximized ? "Restore size" : "Maximize"} onClick={toggleMaximized}>
            {maximized ? <Minimize2 size={7} aria-hidden="true" /> : null}
          </button>
        </span>
        <span className="wb-preview-float-title">Notepad</span>
        {!minimized && <span role="group" aria-label="Notepad view" className="wb-preview-float-actions">
          <button type="button" className="wb-tb wb-n34" aria-label="Edit only" title="Edit" aria-pressed={view === "edit"} onClick={() => setView("edit")}><Pencil size={13} aria-hidden="true" /></button>
          <button type="button" className="wb-tb wb-n34" aria-label="Edit and preview side by side" title="Side by side" aria-pressed={view === "split"} onClick={() => setView("split")}><Columns2 size={13} aria-hidden="true" /></button>
          <button type="button" className="wb-tb wb-n34" aria-label="Markdown preview only" title="Preview" aria-pressed={view === "preview"} onClick={() => setView("preview")}><Eye size={13} aria-hidden="true" /></button>
        </span>}
      </header>
      {!minimized && <>
        <div role="tablist" aria-label="Notes" className="flex h-8 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-[var(--line)] bg-[var(--side)] px-1.5 pt-1">
          {instructions && (
            <div className={`flex min-w-0 max-w-[140px] shrink-0 items-center rounded-t-md px-2.5 text-[12px] ${showingInstructions ? "bg-[var(--code)] text-[var(--tx)]" : "text-[var(--mu)] hover:text-[var(--tx)]"}`}>
              <button type="button" role="tab" aria-selected={showingInstructions} onClick={() => setOnInstructions(true)} className="min-w-0 flex-1 truncate py-1 text-left">
                Instructions
              </button>
            </div>
          )}
          {store.notes.map((note, index) => {
            const selected = !showingInstructions && note.id === active.id;
            return (
              <div key={note.id} className={`group flex min-w-0 max-w-[140px] shrink-0 items-center gap-1 rounded-t-md pl-2.5 pr-1 text-[12px] ${selected ? "bg-[var(--code)] text-[var(--tx)]" : "text-[var(--mu)] hover:text-[var(--tx)]"}`}>
                <button type="button" role="tab" aria-selected={selected} onClick={() => { setOnInstructions(false); update({ ...store, activeId: note.id }); }} className="min-w-0 flex-1 truncate py-1 text-left">
                  {tabTitle(note, index)}
                </button>
                <button type="button" aria-label={`Close ${tabTitle(note, index)}`} title="Close tab" onClick={() => closeTab(note.id)} className="grid size-4 shrink-0 place-items-center rounded text-[var(--mu)] hover:bg-[var(--hover)] hover:text-[var(--tx)]">
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <button type="button" aria-label="New note" title="New note" onClick={addTab} className="grid size-6 shrink-0 place-items-center self-center rounded-md text-[var(--mu)] hover:bg-[var(--hover)] hover:text-[var(--tx)]">
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>
        <div className={`flex min-h-0 flex-1 ${view === "split" ? "divide-x divide-[var(--line)]" : ""}`}>
          {showEditor && <textarea
            aria-label="Note text"
            value={active.text}
            placeholder="Jot down notes while you work… Markdown works too."
            spellCheck={false}
            onChange={(event) => editActive(event.target.value)}
            className="min-h-0 min-w-0 flex-1 resize-none bg-[var(--code)] p-3 font-mono text-[13px] leading-relaxed text-[var(--tx)] outline-none placeholder:text-[var(--mu)]"
          />}
          {showPreview && <article aria-label={showingInstructions ? "Instructions" : "Rendered Markdown"} className="wb-notepad-preview min-h-0 min-w-0 flex-1">
            {showingInstructions
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructions}</ReactMarkdown>
              : active.text.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{active.text}</ReactMarkdown> : <p className="text-[var(--mu)]">Nothing to render yet.</p>}
          </article>}
        </div>
        {!maximized && <div
          aria-hidden="true"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          className="absolute bottom-0 right-0 size-4 cursor-nwse-resize touch-none"
        />}
      </>}
    </section>
  );
}
