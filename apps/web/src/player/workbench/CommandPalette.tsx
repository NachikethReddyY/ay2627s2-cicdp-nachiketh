import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import FileBadge from "./FileBadge";
import { filterItems, parseQuery, type PaletteItem, type PaletteMode } from "./palette";

export type PaletteCommand = PaletteItem & { run(): void };

type Props = {
  open: boolean;
  initial: PaletteMode;
  files: PaletteItem[];
  commands: PaletteCommand[];
  docs: PaletteItem[];
  onOpenFile(id: string): void;
  onOpenDoc(id: string): void;
  onClose(): void;
};

const PREFIX: Record<PaletteMode, string> = { file: "", cmd: ">", doc: "?" };
const HEADING: Record<PaletteMode, string> = { file: "Files", cmd: "Commands", doc: "Docs" };
const PLACEHOLDER: Record<PaletteMode, string> = {
  file: "Search files, > commands, ? docs",
  cmd: "Type a command",
  doc: "Search the docs",
};

const MODES: { mode: PaletteMode; label: string; glyph: "file" | ">" | "?" }[] = [
  { mode: "file", label: "Files", glyph: "file" },
  { mode: "cmd", label: "Commands (>)", glyph: ">" },
  { mode: "doc", label: "Docs (?)", glyph: "?" },
];

export default function CommandPalette({ open, initial, files, commands, docs, onOpenFile, onOpenDoc, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnTo = useRef<Element | null>(null);
  const [query, setQuery] = useState(PREFIX[initial]);
  const [index, setIndex] = useState(0);
  const uid = useId();

  // Open and close the native modal dialog; remember where focus was and give it back on close.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement;
      d.showModal();
      inputRef.current?.focus();
    } else if (!open && d.open) {
      d.close();
      const el = returnTo.current;
      returnTo.current = null;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    }
  }, [open]);

  // Each opening (or a shortcut for another mode while open) starts from that mode's prefix.
  useEffect(() => {
    if (!open) return;
    setQuery(PREFIX[initial]);
    setIndex(0);
  }, [open, initial]);

  const { mode, term } = parseQuery(query);
  const results = useMemo<PaletteItem[]>(
    () => filterItems(mode === "file" ? files : mode === "cmd" ? commands : docs, term),
    [mode, term, files, commands, docs],
  );
  const sel = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel, results]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    if (mode === "file") onOpenFile(item.id);
    else if (mode === "doc") onOpenDoc(item.id);
    else (item as PaletteCommand).run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setIndex((sel + step + results.length) % results.length);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(results[sel]);
    }
  };

  const setMode = (m: PaletteMode) => {
    setQuery(PREFIX[m] + (m === mode ? query.slice(PREFIX[mode].length) : ""));
    setIndex(0);
    inputRef.current?.focus();
  };

  const optionId = (i: number) => `${uid}-opt-${i}`;

  return (
    <dialog
      ref={dialogRef}
      className="wb-pal"
      aria-label="Search and commands"
      onCancel={(e) => {
        e.preventDefault(); // we close it ourselves so focus goes back
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="wb-pal-top">
        <div className="wb-pal-glass wb-pal-search">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-[var(--mu)]">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M20.5 20.5L16 16" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search files, commands and docs"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={results.length ? optionId(sel) : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={PLACEHOLDER[mode]}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="wb-mono wb-pal-esc" aria-hidden="true">esc</span>
        </div>
        <div className="wb-pal-glass wb-pal-modes" role="group" aria-label="Search in">
          {MODES.map((m) => (
            <button key={m.mode} type="button" aria-label={m.label} title={m.label} aria-pressed={m.mode === mode} onClick={() => setMode(m.mode)}>
              {m.glyph === "file" ? (
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" />
                  <path d="M14 3.5v4h4" />
                </svg>
              ) : (
                <span className="wb-mono" aria-hidden="true">{m.glyph}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-pal-glass wb-pal-card">
        <ul id={`${uid}-list`} ref={listRef} role="listbox" aria-label={HEADING[mode]} className="wb-scroll wb-pal-list">
          <li role="presentation" className="wb-sec" aria-hidden="true">{HEADING[mode]}</li>
          {results.map((r, i) => (
            <li
              key={r.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === sel}
              className="wb-pal-row"
              onMouseMove={() => i !== sel && setIndex(i)}
              onClick={() => choose(r)}
            >
              {mode === "file" && <FileBadge path={r.title} />}
              <span className="wb-pal-title">{r.title}</span>
              {r.sub && <span className="wb-pal-sub">{r.sub}</span>}
              {r.hint && <kbd className="wb-mono wb-pal-hint">{r.hint}</kbd>}
              {i === sel && <span className="wb-mono wb-pal-enter" aria-hidden="true">↵</span>}
            </li>
          ))}
        </ul>
        {results.length === 0 && <p className="wb-pal-empty">No results for "{term}"</p>}
        <div className="wb-pal-foot" aria-hidden="true">
          <span><kbd className="wb-mono">↑↓</kbd> navigate</span>
          <span><kbd className="wb-mono">↵</kbd> open</span>
          <span className="ml-auto">{results.length} {results.length === 1 ? "result" : "results"}</span>
        </div>
        <span role="status" className="sr-only">{results.length} {results.length === 1 ? "result" : "results"}</span>
      </div>
    </dialog>
  );
}
