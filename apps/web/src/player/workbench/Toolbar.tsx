import { Fragment, type ReactNode, type Ref } from "react";
import { ChevronLeft, ChevronRight, Folder, PanelBottom, PanelLeft, PanelRight, Search, type LucideIcon } from "lucide-react";
import FileBadge, { FileIcon } from "./FileBadge";
import { Soon } from "./Planned";

type Toggle = { pressed: boolean; onClick(): void; label: string; ref?: Ref<HTMLButtonElement> };

type Props = {
  title: string;
  fileName: string;
  /** Folders above the file, root first. */
  crumbs?: string[];
  /** Symbol under the caret, shown last. */
  symbol?: string;
  /** Leave the breadcrumb row out; the caller draws it (desktop layout). */
  split?: boolean;
  nav: Toggle;
  terminal: Toggle;
  util: Toggle;
  search: { label: string; onClick(): void };
  onRun(): void;
  /** Run / Stop / Check / Next. */
  actions: ReactNode;
  /** Draw the window's traffic lights at the start (the navigator that normally holds them is hidden). */
  lights?: boolean;
  /** Draw the design's planned Back/Forward as inert controls. */
  planned?: boolean;
};

function ToggleButton({ t, icon: Icon }: { t: Toggle; icon: LucideIcon }) {
  return (
    <button ref={t.ref} type="button" className="wb-tb wb-tog" aria-label={t.label} title={t.label} aria-pressed={t.pressed} onClick={t.onClick}>
      <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}

/** The macOS window controls. Decoration only: not buttons, hidden from assistive tech. */
export function TrafficLights() {
  return (
    <span aria-hidden="true" className="wb-lights">
      <span style={{ background: "#ff5f57" }} />
      <span style={{ background: "#febc2e" }} />
      <span style={{ background: "#28c840" }} />
    </span>
  );
}

// The project mark from the design: a rounded square with a sprout.
export const Mark = ({ size, className = "" }: { size: number; className?: string }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" className={`flex-none ${className}`}>
    <rect x="1" y="1" width="14" height="14" rx="4" fill="#3d79e0" />
    <path
      transform="scale(.667)"
      d="M12 18v-6m0 0c0-3 2-5 5-5 0 3-2 5-5 5zm0 0c0-2-1.5-3.5-4-3.5 0 2 1.5 3.5 4 3.5z"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// The purple function mark that starts the symbol crumb.
const SymbolMark = () => (
  <svg viewBox="0 0 16 16" width={15} height={15} aria-hidden="true" className="flex-none">
    <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="#a56bd6" />
    <path d="M6.2 11.5c.6 0 .9-.3.9-1V7M7.1 5.2h.01M9 11.5V6.3c0-.6.3-1 1-1" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The file path row. In the stacked layout it sits under the toolbar (border on top); in the desktop layout it
 *  heads the editor column beside the Docs header, sharing one bottom line (`edge="bottom"`). */
export function Breadcrumbs({ title, fileName, crumbs, symbol, edge }: { title: string; fileName: string; crumbs?: string[]; symbol?: string; edge: "top" | "bottom" }) {
  return (
  <nav aria-label="File path" className={`flex h-[33px] flex-none items-center overflow-hidden border-[var(--line)] px-3.5 text-[var(--mu)] ${edge === "top" ? "border-t" : "border-b bg-[var(--tbar)]"}`}>
      <ol className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        {crumbs ? (
          <>
            {crumbs.map((c, i) => (
              <Fragment key={crumbs.slice(0, i + 1).join("/")}>
                <li className="flex items-center gap-[5px]">
                  {i === 0 ? <Mark size={15} /> : <Folder size={15} strokeWidth={1.2} fill="#7aa2d8" stroke="#7aa2d8" aria-hidden="true" className="flex-none" />}
                  {c}
                </li>
                <li aria-hidden="true">›</li>
              </Fragment>
            ))}
            <li className="flex items-center gap-[5px]" aria-current={symbol ? undefined : "page"}>
              <FileIcon path={fileName} size={15} />
              {fileName}
            </li>
            {symbol && (
              <>
                <li aria-hidden="true">›</li>
                <li className="wb-mono flex items-center gap-[5px] text-[var(--tx)]" aria-current="page">
                  <SymbolMark />
                  {symbol}
                </li>
              </>
            )}
          </>
        ) : (
          <>
            <li className="flex items-center gap-[5px]">
              <Mark size={15} />
              learnslop
            </li>
            <li aria-hidden="true">›</li>
            <li className="truncate">{title}</li>
            <li aria-hidden="true">›</li>
            <li className="wb-mono flex items-center gap-1.5 text-[var(--tx)]" aria-current="page">
              <FileBadge path={fileName} />
              {fileName}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

export default function Toolbar({ title, fileName, crumbs, symbol, split = false, nav, terminal, util, search, onRun, actions, lights = false, planned = false }: Props) {
  return (
    <header className="flex flex-none flex-col border-b border-[var(--line)] bg-[var(--tbar)]">
      <div className="flex h-12 flex-none items-center gap-2 px-2 sm:gap-3 sm:px-3">
        {lights && <TrafficLights />}
        {planned && (
          <span className="wb-pill flex-none gap-0 shadow-[0_1px_2px_rgba(20,30,70,.1)]">
            <Soon label="Back" className="wb-tb wb-wide">
              <ChevronLeft size={18} strokeWidth={2.3} aria-hidden="true" />
            </Soon>
            <Soon label="Forward" className="wb-tb wb-wide" style={{ color: "var(--mu)" }}>
              <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
            </Soon>
          </span>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap">
          <a href="/" className="flex flex-none items-center gap-1.5 rounded text-[13px] font-semibold" aria-label="LearnSlop home">
            <Mark size={18} className="sm:hidden" />
            <span className="max-sm:hidden">LearnSlop</span>
          </a>
          <span aria-hidden="true" className="text-[var(--mu)] max-sm:hidden lg:hidden">/</span>
          {/* The design has no lesson title in the toolbar; it stays for screen readers and the narrow layout. */}
          <h1 className="min-w-0 truncate text-[13px] font-normal text-[var(--mu)] lg:sr-only">{title}</h1>
        </div>
        <button type="button" className="wb-tb wb-tog" aria-label={search.label} title={search.label} onClick={search.onClick}>
          <Search size={17} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <div
          className="wb-pill flex-none"
          onClickCapture={(event) => {
            const button = (event.target as Element).closest("button");
            if (button?.title.toLowerCase() === "run" || button?.getAttribute("aria-label")?.toLowerCase() === "run") onRun();
          }}
        >{actions}</div>
        <span className="flex flex-none items-center gap-px">
          <ToggleButton t={nav} icon={PanelLeft} />
          <ToggleButton t={terminal} icon={PanelBottom} />
          <ToggleButton t={util} icon={PanelRight} />
        </span>
      </div>
      {!split && <Breadcrumbs title={title} fileName={fileName} crumbs={crumbs} symbol={symbol} edge="top" />}
    </header>
  );
}
